import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, doc, deleteDoc, writeBatch, updateDoc } from 'firebase/firestore';
import { BUYER_OPTIONS } from '../types';
import type { SizeConfig } from '../types';
import { FileSpreadsheet, RotateCcw, Plus, Trash2, Edit, X } from 'lucide-react';

// Measurement options with deduction value for Gross Weight
// Gross Weight = Net Weight - deduction
const MEASUREMENT_OPTIONS = [
    { value: '49 x 39 x 40', deduction: 1.1 },
    { value: '49 x 39 x 30', deduction: 0.900 },
    { value: '49 x 39 x 20', deduction: 0.700 },
];

interface RowInput {
    print: string;
    style: string;
    sizes: { [key: string]: string }; // keeping as string for input handling, convert to number later
}

const INITIAL_ROW_STATE: RowInput = {
    print: '',
    style: '',
    sizes: {} // Empty initially, populated dynamically
};

const DataEntry: React.FC = () => {
    const { user } = useAuth();
    const [buyer, setBuyer] = useState(BUYER_OPTIONS[0]);
    const [storeName, setStoreName] = useState('');

    // Global Carton Details
    const [netWeight, setNetWeight] = useState('');
    const [grossWeight, setGrossWeight] = useState('');
    const [measurement, setMeasurement] = useState('');

    // Current input row
    const [currentRow, setCurrentRow] = useState<RowInput>(INITIAL_ROW_STATE);

    // Fetched saved rows for the current "Draft" carton
    const [savedRows, setSavedRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeBatchId, setActiveBatchId] = useState<string>('');
    const [dropdowns, setDropdowns] = useState<{ prints: string[], styles: string[], stores: string[] }>({ prints: [], styles: [], stores: [] });
    const [sizeList, setSizeList] = useState<SizeConfig[]>([]);
    const [editingRowId, setEditingRowId] = useState<string | null>(null);

    // Password Modal State
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwordInput, setPasswordInput] = useState('');
    const [passwordError, setPasswordError] = useState(false);

    // Fetch Settings
    useEffect(() => {
        // Active Batch
        const settingsRef = doc(db, 'settings', 'general');
        const unsubSettings = onSnapshot(settingsRef, (snap) => {
            if (snap.exists()) {
                setActiveBatchId(snap.data().activeBatchId || 'BATCH_INITIAL');
            } else {
                setActiveBatchId('BATCH_INITIAL');
            }
        });

        // Dropdown Settings
        const dropRef = doc(db, 'settings', 'dropdowns');
        const unsubDrops = onSnapshot(dropRef, async (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setDropdowns({
                    prints: data.prints || [],
                    styles: data.styles || [],
                    stores: data.stores || [],
                });
            } else {
                // Initial set if needed, skipped for brevity as Admin handles init
            }
        });

        // Size Settings
        const sizeRef = doc(db, 'settings', 'sizes');
        const unsubSizes = onSnapshot(sizeRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                const list = (data.list || []) as SizeConfig[];
                // Smart sort: numeric sizes by actual value, alpha sizes after numerics
                list.sort((a, b) => {
                    const aNum = parseFloat(a.label);
                    const bNum = parseFloat(b.label);
                    const aIsNum = !isNaN(aNum);
                    const bIsNum = !isNaN(bNum);
                    if (aIsNum && bIsNum) return aNum - bNum;
                    if (aIsNum) return -1;
                    if (bIsNum) return 1;
                    return a.order - b.order;
                });
                setSizeList(list);
            } else {
                setSizeList([]);
            }
        });

        return () => {
            unsubSettings();
            unsubDrops();
            unsubSizes();
        };
    }, []);

    // Load draft rows for this user (scoped to batch?) 
    // Drafts are specific to user and "cartonId == null". 
    // Should drafts also be scoped to batch? YES. Otherwise old drafts might get saved to new batch.
    useEffect(() => {
        if (!user || !activeBatchId) return;

        // Query rows created by user that are NOT assigned to a carton yet (cartonId == null)
        const q = query(
            collection(db, 'carton_rows'),
            where('createdBy', '==', user.email),
            where('cartonId', '==', null), // Unassigned rows
            where('batchId', '==', activeBatchId), // Scope draft to batch!
            orderBy('createdAt', 'asc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setSavedRows(rows);
            setLoading(false);
        });

        return unsubscribe;
    }, [user, activeBatchId]);

    const handleSizeChange = (size: string, value: string) => {
        // Allow digits and optional leading minus (-) only. Block plus (+) and other chars.
        if (value && !/^-?\d*$/.test(value)) return;

        setCurrentRow(prev => ({
            ...prev,
            sizes: { ...prev.sizes, [size]: value }
        }));
    };

    const calculateTotalPcs = (sizes: { [key: string]: string }) => {
        return Object.values(sizes).reduce((sum, val) => sum + (Number(val) || 0), 0);
    };

    const handleEditRow = (row: any) => {
        setCurrentRow({
            print: row.print,
            style: row.style,
            sizes: row.sizes || {}
        });
        setEditingRowId(row.id);
    };

    const handleCancelEdit = () => {
        setEditingRowId(null);
        setCurrentRow(INITIAL_ROW_STATE);
    };

    const handleSaveRow = async () => {
        if (!user) return;
        if (!activeBatchId) {
            alert("System loading or Batch ID missing. Please wait.");
            return;
        }

        if (calculateTotalPcs(currentRow.sizes) === 0) {
            alert("Row must have at least one piece.");
            return;
        }
        if (!currentRow.print || !currentRow.style) {
            alert("Print and Style are required.");
            return;
        }

        try {
            const rowData = {
                print: currentRow.print.trim(),
                style: currentRow.style.trim(),
                sizes: Object.entries(currentRow.sizes).reduce((acc, [key, val]) => {
                    if (val) acc[key] = Number(val);
                    return acc;
                }, {} as { [key: string]: number }),
                totalPcs: calculateTotalPcs(currentRow.sizes),
                // Keep existing metadata or update?
                // Usually metadata like buyer/store should match current form if we assume user edits in context.
                // But row might be older. Let's update buyer/store to match current selection if user changed it, 
                // OR technically drafts reuse current context.
                // We'll update everything to current form state (Buyer/Store etc).
                buyer,
                storeName,
                // createdBy... keep original? Or update modifiedBy? 
                // Simple version: just update fields.
                // batchId... keep batch.
            };

            if (editingRowId) {
                // UPDATE
                await updateDoc(doc(db, 'carton_rows', editingRowId), {
                    ...rowData,
                    updatedAt: serverTimestamp()
                });
                setEditingRowId(null);
            } else {
                // CREATE
                await addDoc(collection(db, 'carton_rows'), {
                    ...rowData,
                    cartonId: null,
                    createdBy: user.email,
                    createdAt: serverTimestamp(),
                    batchId: activeBatchId
                });
            }

            // Clear current row inputs
            setCurrentRow(INITIAL_ROW_STATE);

        } catch (error) {
            console.error("Error saving row:", error);
            alert("Failed to save row. Check console.");
        }
    };

    // Called when user clicks "Save & Finalize Carton"
    const handleFinalizeClick = () => {
        setPasswordInput('');
        setPasswordError(false);
        setShowPasswordModal(true);
    };

    // Called after password is confirmed
    const handlePasswordConfirm = () => {
        if (passwordInput === '1122') {
            setShowPasswordModal(false);
            setPasswordInput('');
            setPasswordError(false);
            handleSaveToExcel();
        } else {
            setPasswordError(true);
        }
    };

    const handleSaveToExcel = async () => {
        if (savedRows.length === 0) {
            alert("No saved rows to export!");
            return;
        }
        if (!storeName || !netWeight || !grossWeight || !measurement) {
            alert("Please fill in Store Name and all Global Carton Details (Net/Gross Weight, Measurement).");
            return;
        }
        if (!activeBatchId) {
            alert("Batch ID missing.");
            return;
        }

        if (!confirm("Are you sure you want to finalize this carton? This will create 1 Carton record.")) return;

        try {
            const batch = writeBatch(db);

            // 1. Create Carton Document
            const totalPcs = savedRows.reduce((sum, row) => sum + row.totalPcs, 0);

            const cartonRef = doc(collection(db, 'cartons'));
            batch.set(cartonRef, {
                buyer,
                storeName,
                season: 'WINTER 2025',
                netWeight: Number(netWeight),
                grossWeight: Number(grossWeight),
                measurement,
                totalPcs,
                createdBy: user?.email,
                createdAt: serverTimestamp(),
                batchId: activeBatchId // Tag with Batch
            });

            // 2. Link Rows to Carton
            savedRows.forEach(row => {
                const rowRef = doc(db, 'carton_rows', row.id);
                batch.update(rowRef, { cartonId: cartonRef.id });
            });

            await batch.commit();

            // 3. Reset Validations/State
            // "Buyer & Store Name remain unchanged" -> Actually prompts says "Automatically adds a new empty row... Buyer & Store Name remain unchanged" for SAVE.
            // For SAVE TO EXCEL? "Creates ONE carton record". 
            // Usually users continue with same Buyer/Store for next carton.
            // I will keep Buyer/Store. 
            // Clear Global Details? Maybe keep them too as boxes often same?
            // Prompt says "RESET ... Clears Buyer, Store Name, all rows, quantities".
            // So Save to Excel probably keeps them? I'll keep them for efficiency.

            setSavedRows([]); // Local state clears (snapshot will verify)
            alert("Carton Finalized Successfully!");

        } catch (error) {
            console.error("Error finalizing carton:", error);
            alert("Failed to save carton.");
        }
    };

    const handleReset = () => {
        if (!confirm("Are you sure? This will clear all inputs and UNSAVED row data. Saved rows remain in DB until finalized.")) return;
        // Actually "Reset Clears ... all rows". Does it mean delete draft rows from DB?
        // "Confirmation popup mandatory".
        // I will assume it clears the FORM inputs. Deleting draft rows might be dangerous if just clearing form.
        // But "Clears ... quantities" implies the current session.
        // Use Reset to start fresh.
        setBuyer(BUYER_OPTIONS[0]);
        setStoreName('');
        setNetWeight('');
        setGrossWeight('');
        setMeasurement('');
        setCurrentRow(INITIAL_ROW_STATE);
    };

    // Safe delete for draft rows
    const deleteDraftRow = async (id: string) => {
        if (confirm("Delete this row?")) {
            try {
                await deleteDoc(doc(db, 'carton_rows', id));
            } catch (error) {
                console.error("Error deleting row:", error);
                alert("Failed to delete row.");
            }
        }
    };

    return (
        <>
        <div className="space-y-6">
            {/* Top Section */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-4 capitalize">Data Entry</h1>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Buyer <span className="text-red-500">*</span></label>
                        <select
                            value={buyer}
                            onChange={(e) => setBuyer(e.target.value)}
                            className="input-field bg-gray-50 border-gray-300"
                        >
                            {BUYER_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Store Name <span className="text-red-500">*</span></label>
                        <select
                            value={storeName}
                            onChange={(e) => setStoreName(e.target.value)}
                            className="input-field bg-gray-50 border-gray-300 font-medium"
                        >
                            <option value="">Select Store</option>
                            {dropdowns.stores.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Global Carton Details */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Global Carton Details (Mandatory)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Measurement (cm)</label>
                        <select
                            value={measurement}
                            onChange={(e) => setMeasurement(e.target.value)}
                            className="input-field bg-gray-50"
                        >
                            <option value="">Select Measurement</option>
                            {MEASUREMENT_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.value}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Gross Weight (Kg)
                        </label>
                        <input
                            type="number"
                            step="0.001"
                            value={grossWeight}
                            onChange={(e) => {
                                const gross = parseFloat(e.target.value);
                                setGrossWeight(e.target.value);
                                // Auto-calculate Net = Gross - deduction
                                const selectedOpt = MEASUREMENT_OPTIONS.find(o => o.value === measurement);
                                if (selectedOpt && !isNaN(gross)) {
                                    const net = gross - selectedOpt.deduction;
                                    setNetWeight(net >= 0 ? net.toFixed(3) : '0.000');
                                } else {
                                    setNetWeight('');
                                }
                            }}
                            placeholder="e.g. 10"
                            className="input-field"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Net Weight (Kg)
                            {measurement && (
                                <span className="ml-2 text-xs font-normal text-green-700 bg-green-50 px-1.5 py-0.5 rounded">
                                    = Gross − {MEASUREMENT_OPTIONS.find(o => o.value === measurement)?.deduction}
                                </span>
                            )}
                        </label>
                        <input
                            type="number"
                            step="0.001"
                            value={netWeight}
                            readOnly
                            placeholder="Auto-calculated"
                            className="input-field bg-green-50 text-green-800 cursor-not-allowed select-none"
                        />
                    </div>
                </div>
            </div>

            {/* Entry Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead>
                            <tr className="bg-gray-50">
                                <th className="table-header sticky left-0 z-10 bg-gray-50">Print</th>
                                <th className="table-header sticky left-[100px] z-10 bg-gray-50">Style</th>
                                {sizeList.map(size => (
                                    <th key={size.id} className="table-header text-center w-16 px-1">
                                        <div className="flex flex-col items-center">
                                            <span>{size.label}</span>
                                        </div>
                                    </th>
                                ))}
                                <th className="table-header text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {/* Loading State */}
                            {loading && (
                                <tr>
                                    <td colSpan={(sizeList.length || 10) + 4} className="p-8 text-center text-gray-500">
                                        Loading drafts...
                                    </td>
                                </tr>
                            )}

                            {/* Saved Rows (Drafts) */}
                            {savedRows.map(row => (
                                <tr key={row.id} className="bg-gray-50/50">
                                    <td className="table-cell sticky left-0 bg-gray-50/50 font-medium text-gray-600">{row.print}</td>
                                    <td className="table-cell sticky left-[100px] bg-gray-50/50 font-medium text-gray-600">{row.style}</td>
                                    {sizeList.map(size => (
                                        <td key={size.id} className="table-cell text-center text-gray-500">
                                            {row.sizes[size.label] || '-'}
                                        </td>
                                    ))}
                                    <td className="table-cell text-right font-bold text-gray-700">{row.totalPcs}</td>
                                    <td className="table-cell w-20 text-center">
                                        <div className="flex justify-center gap-1">
                                            <button
                                                onClick={() => handleEditRow(row)}
                                                className="text-blue-500 hover:text-blue-700 p-1 rounded hover:bg-blue-50 transition-colors"
                                                title="Edit Row"
                                            >
                                                <Edit size={16} />
                                            </button>
                                            <button
                                                onClick={() => deleteDraftRow(row.id)}
                                                className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors"
                                                title="Delete Row"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}

                            {/* Input Row */}
                            <tr className={`bg-blue-50/10 ${editingRowId ? 'ring-2 ring-blue-400' : ''}`}>
                                <td className="p-2 sticky left-0 bg-white z-10 shadow-r">
                                    <select
                                        className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                                        value={currentRow.print}
                                        onChange={(e) => setCurrentRow(prev => ({ ...prev, print: e.target.value }))}
                                    >
                                        <option value="">Select</option>
                                        {dropdowns.prints.map(opt => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                    </select>
                                </td>
                                <td className="p-2 sticky left-[100px] bg-white z-10 shadow-r">
                                    <select
                                        className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                                        value={currentRow.style}
                                        onChange={(e) => setCurrentRow(prev => ({ ...prev, style: e.target.value }))}
                                    >
                                        <option value="">Select</option>
                                        {dropdowns.styles.map(opt => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                    </select>
                                </td>
                                {sizeList.map(size => (
                                    <td key={size.id} className="p-2 text-center">
                                        <input
                                            type="text"
                                            className={`w-12 px-1 py-1 border rounded text-center text-sm ${currentRow.sizes[size.label]
                                                    ? Number(currentRow.sizes[size.label]) < 0
                                                        ? 'border-red-400 bg-red-50 text-red-700'
                                                        : 'border-blue-500 bg-blue-50'
                                                    : 'border-gray-200'
                                                }`}
                                            value={currentRow.sizes[size.label] || ''}
                                            onChange={(e) => handleSizeChange(size.label, e.target.value)}
                                        />
                                    </td>
                                ))}
                                <td className="p-2 text-right font-bold text-blue-600">
                                    {calculateTotalPcs(currentRow.sizes)}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* Actions */}
                <div className="p-4 bg-gray-50 border-t border-gray-200 flex flex-wrap gap-4 justify-between items-center">
                    <div className="text-sm text-gray-500">
                        {savedRows.length} rows saved in draft. {editingRowId && <span className="text-blue-600 font-bold ml-2">EDITING ROW...</span>}
                    </div>
                    <div className="flex gap-4">
                        {editingRowId ? (
                            <button onClick={handleCancelEdit} className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-200 rounded flex items-center gap-2">
                                <X size={18} /> Cancel
                            </button>
                        ) : (
                            <button onClick={handleReset} className="px-4 py-2 text-red-600 font-medium hover:bg-red-50 rounded flex items-center gap-2">
                                <RotateCcw size={18} /> Reset
                            </button>
                        )}

                        <button onClick={handleSaveRow} className={`flex items-center gap-2 btn-secondary ${editingRowId ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}>
                            {editingRowId ? <Edit size={18} /> : <Plus size={18} />}
                            {editingRowId ? 'Update Row' : 'Save Row'}
                        </button>
                        <button onClick={handleFinalizeClick} className="btn-primary flex items-center gap-2">
                            <FileSpreadsheet size={18} /> Save & Finalize Carton
                        </button>
                    </div>
                </div>
            </div>
        </div>

        {/* Password Modal */}
            {showPasswordModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4 animate-fadeIn">
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                            </div>
                            <h2 className="text-xl font-bold text-gray-900">Enter Password</h2>
                            <p className="text-sm text-gray-500 text-center">Password required to finalize and save the carton.</p>
                            <input
                                type="password"
                                className={`w-full px-4 py-3 border-2 rounded-lg text-center text-xl tracking-widest font-mono focus:outline-none transition-colors ${
                                    passwordError
                                        ? 'border-red-400 bg-red-50 text-red-700 focus:border-red-500'
                                        : 'border-gray-300 focus:border-blue-500'
                                }`}
                                placeholder="••••"
                                value={passwordInput}
                                onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
                                onKeyDown={(e) => { if (e.key === 'Enter') handlePasswordConfirm(); }}
                                autoFocus
                                maxLength={10}
                            />
                            {passwordError && (
                                <p className="text-sm text-red-600 font-medium">❌ Incorrect password. Try again.</p>
                            )}
                            <div className="flex gap-3 w-full mt-2">
                                <button
                                    onClick={() => { setShowPasswordModal(false); setPasswordInput(''); setPasswordError(false); }}
                                    className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handlePasswordConfirm}
                                    className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
                                >
                                    Confirm
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default DataEntry;
