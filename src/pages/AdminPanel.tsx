import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, orderBy, onSnapshot, doc, setDoc, getDocs, updateDoc, where, writeBatch } from 'firebase/firestore';
import type { Carton, CartonRow, SizeConfig } from '../types';
import { generatePackingList, generateCartonSheet } from '../utils/excelGenerator';
import { Layers, Package, Settings as SettingsIcon, Edit, X, Plus, FileSpreadsheet, Trash2, Undo2 } from 'lucide-react';
import EditCartonModal from '../components/EditCartonModal';
import StoreTargetsAnalytics from '../components/StoreTargetsAnalytics';

const AdminPanel: React.FC = () => {
    const { user } = useAuth();
    const [cartons, setCartons] = useState<Carton[]>([]);
    const [season, setSeason] = useState('WINTER 2025'); // Default fallback
    const [activeBatchId, setActiveBatchId] = useState<string>('');
    const [isSeasonDirty, setIsSeasonDirty] = useState(false);
    const [tempSeason, setTempSeason] = useState('');
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [lastDeleted, setLastDeleted] = useState<{ carton: any, rows: any[] } | null>(null);
    const [showUndo, setShowUndo] = useState(false);

    // Edit Modal State
    const [editingCarton, setEditingCarton] = useState<Carton | null>(null);

    // Dynamic Dropdowns State
    const [dropdowns, setDropdowns] = useState<{ prints: string[], styles: string[], stores: string[] }>({ prints: [], styles: [], stores: [] });
    const [newOption, setNewOption] = useState('');
    const [optionType, setOptionType] = useState<'print' | 'style' | 'store'>('print');

    // Size Management State
    const [sizeList, setSizeList] = useState<SizeConfig[]>([]);
    const [newSizeLabel, setNewSizeLabel] = useState('');
    const [newSizeType, setNewSizeType] = useState<'numeric' | 'alpha'>('numeric');

    // Password Modal State
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwordInput, setPasswordInput] = useState('');
    const [passwordError, setPasswordError] = useState(false);

    // 1. Fetch Settings (Season, Batch, Dropdowns)
    useEffect(() => {
        const fetchSettings = async () => {
            // General Settings
            const docRef = doc(db, 'settings', 'general');
            onSnapshot(docRef, (snap) => {
                if (snap.exists()) {
                    const data = snap.data();
                    setSeason(data.season);
                    setTempSeason(data.season);
                    setActiveBatchId(data.activeBatchId || 'BATCH_INITIAL');
                } else {
                    setDoc(docRef, { season: 'WINTER 2025', activeBatchId: 'BATCH_INITIAL' });
                    setTempSeason('WINTER 2025');
                    setActiveBatchId('BATCH_INITIAL');
                }
            });

            // Dropdown Settings
            const dropRef = doc(db, 'settings', 'dropdowns');
            onSnapshot(dropRef, async (snap) => {
                if (snap.exists()) {
                    setDropdowns(snap.data() as any);
                } else {
                    // Seed with initial constants if missing
                    const initialData = {
                        prints: [
                            "Beach Pig", "Clover - Dandelion Yellow", "Clover - Sulphur Spring Green", "Clover - Vibrant Orange",
                            "Fruits - Beach Glass", "Fruits - Blushing Bride", "Happy Flower", "Jellyfish",
                            "Jumbled Radish - Blue", "Jumbled Radish", "Jumbled Radish - Pink", "Multi Radish - Blue",
                            "Multi Radish - Pink", "Radish - Patina Green", "Radish - Lilac Chiffon", "Radish - Marina Blue",
                            "Radish - Sunshine Pale Yellow"
                        ],
                        styles: [
                            "Baggy Pants", "Bedding", "Bonnet", "Double Layer Hat", "Dungaree", "Kimono Body", "Knot Hat",
                            "Lap Neck Body", "Leggings", "Long Sleeve Lap neck Body", "Long Sleeve Lap neck Suit",
                            "Long Sleeve Skater Dress", "Long Sleeve Gather Dress", "Long Sleeve Top", "Pants", "Play Suit",
                            "Short Pants", "Short Sleeve Skater Dress", "Short Sleeve Top", "Sleeveless Gather Dress",
                            "Summer Suit", "Sun Hat", "Zip Suit", "Hood Suit", "TERRY SHORT PANT"
                        ],
                        stores: []
                    };
                    await setDoc(dropRef, initialData);
                    setDropdowns(initialData);
                }
            });

            // Size Settings
            const sizeRef = doc(db, 'settings', 'sizes');
            onSnapshot(sizeRef, async (snap) => {
                if (snap.exists()) {
                    const data = snap.data();
                    const list = (data.list || []) as SizeConfig[];
                    // Smart sort: numeric sizes by value, alpha sizes after numerics
                    list.sort((a, b) => {
                        const aNum = parseFloat(a.label);
                        const bNum = parseFloat(b.label);
                        const aIsNum = !isNaN(aNum);
                        const bIsNum = !isNaN(bNum);
                        if (aIsNum && bIsNum) return aNum - bNum;
                        if (aIsNum) return -1; // numerics before alphas
                        if (bIsNum) return 1;
                        return a.order - b.order; // alpha sizes keep their order
                    });
                    setSizeList(list);
                } else {
                    // Seed initial empty or default? user prompt says "Users cannot add... All new entries must persist".
                    // Let's seed with empty list to initialize doc
                    await setDoc(sizeRef, { list: [] });
                    setSizeList([]);
                }
            });
        };
        fetchSettings();
    }, []);

    const handleAddOption = async () => {
        if (!newOption.trim()) return;
        const field = optionType === 'print' ? 'prints' : optionType === 'style' ? 'styles' : 'stores';
        // Check duplicate
        const currentList = optionType === 'print' ? dropdowns.prints : optionType === 'style' ? dropdowns.styles : (dropdowns.stores || []);
        if (currentList.some(o => o.toLowerCase() === newOption.trim().toLowerCase())) {
            alert("Option already exists!");
            return;
        }

        try {
            const dropRef = doc(db, 'settings', 'dropdowns');
            const newList = optionType === 'store'
                ? [...currentList, newOption.trim()].sort()
                : [...currentList, newOption.trim()].sort();
            await updateDoc(dropRef, { [field]: newList });
            setNewOption('');
            const label = optionType === 'print' ? 'Print' : optionType === 'style' ? 'Style' : 'Store';
            alert(`${label} added!`);
        } catch (e) {
            console.error(e);
            alert("Failed to add option.");
        }
    };

    const handleDeleteOption = async (type: 'print' | 'style' | 'store', value: string) => {
        if (!confirm(`Delete ${value}?`)) return;
        try {
            const dropRef = doc(db, 'settings', 'dropdowns');
            const currentList = type === 'print' ? dropdowns.prints : type === 'style' ? dropdowns.styles : (dropdowns.stores || []);
            const newList = currentList.filter(o => o !== value);
            const field = type === 'print' ? 'prints' : type === 'style' ? 'styles' : 'stores';
            await updateDoc(dropRef, { [field]: newList });
        } catch (e) {
            console.error(e);
            alert("Failed to delete.");
        }
    };

    const calcSmartOrder = (label: string): number => {
        const num = parseFloat(label);
        if (!isNaN(num)) {

            return num * 10;
        } else {

            const alphaCount = sizeList.filter(s => isNaN(parseFloat(s.label))).length;
            return 100000 + alphaCount * 10;
        }
    };

    const handleAddSizeConfig = async () => {
        if (!newSizeLabel.trim()) return;


        if (sizeList.some(s => s.label.toLowerCase() === newSizeLabel.trim().toLowerCase())) {
            alert("Size label already exists!");
            return;
        }

        try {
            const sizeRef = doc(db, 'settings', 'sizes');
            const smartOrder = calcSmartOrder(newSizeLabel.trim());
            const newSize: SizeConfig = {
                id: `SIZE_${Date.now()}`,
                label: newSizeLabel.trim(),
                type: newSizeType,
                order: smartOrder
            };
            const newList = [...sizeList, newSize];
            await updateDoc(sizeRef, { list: newList });

            setNewSizeLabel('');
            alert(`Size "${newSizeLabel.trim()}" added successfully!`);
        } catch (e) {
            console.error("Error adding size:", e);
            alert("Failed to add size");
        }
    };

    const handleDeleteSizeConfig = async (id: string) => {
        if (!confirm("Delete this size?")) return;
        try {
            const sizeRef = doc(db, 'settings', 'sizes');
            const newList = sizeList.filter(s => s.id !== id);
            await updateDoc(sizeRef, { list: newList });
        } catch (e) {
            console.error(e);
            alert("Failed to delete size");
        }
    };


    useEffect(() => {
        if (!activeBatchId) return;

        const q = query(
            collection(db, 'cartons'),
            where('batchId', '==', activeBatchId),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data(),
            })) as Carton[];
            console.log("AdminPanel: Real-time update received", data.length, "cartons");
            setCartons(data);
            setLoading(false);
        });
        return unsubscribe;
    }, [activeBatchId]);

    const handleSaveSeason = async () => {
        try {
            await setDoc(doc(db, 'settings', 'general'), { season: tempSeason }, { merge: true });
            setSeason(tempSeason);
            setIsSeasonDirty(false);
            alert("Season updated!");
        } catch (e) {
            console.error(e);
            alert("Failed to update season");
        }
    };

    const handleNewExcelClick = () => {
        if (user?.role !== 'admin') return;
        setPasswordInput('');
        setPasswordError(false);
        setShowPasswordModal(true);
    };

    const handlePasswordConfirm = () => {
        if (passwordInput === '1122') {
            setShowPasswordModal(false);
            setPasswordInput('');
            setPasswordError(false);
            processNewExcelSheet();
        } else {
            setPasswordError(true);
        }
    };

    const processNewExcelSheet = async () => {
        if (!confirm("Are you sure you want to create a NEW EXCEL SHEET?\n\nThis will finalize the current file and start a fresh list. Old entries will be hidden from this view.")) return;

        try {
            setGenerating(true);
            const newBatchId = `BATCH_${Date.now()}`;


            await setDoc(doc(db, 'settings', 'general'), { activeBatchId: newBatchId }, { merge: true });


            setActiveBatchId(newBatchId);

            alert(`New Excel file created successfully.\nBatch ID: ${newBatchId}\n\nAll new entries will go to this file.`);
        } catch (e) {
            console.error(e);
            alert("Failed to create new Excel sheet.");
        } finally {
            setGenerating(false);
        }
    };



    const handleDownloadPackingList = async () => {
        try {
            setGenerating(true);

            const cartonIds = new Set(cartons.map(c => c.id));
            const rowsSnapshot = await getDocs(query(collection(db, 'carton_rows')));

            const allRows = rowsSnapshot.docs
                .map(d => ({ id: d.id, ...d.data() } as CartonRow))
                .filter(r => r.cartonId && cartonIds.has(r.cartonId));

            const detailedCartons = cartons.map(c => ({
                ...c,
                rows: allRows.filter(r => r.cartonId === c.id)
            }));

            await generatePackingList(detailedCartons);
        } catch (e) {
            console.error("Error generating Packing List:", e);
            alert("Error generating Packing List.");
        } finally {
            setGenerating(false);
        }
    };

    const handleDownloadCartonSheet = async () => {
        try {
            setGenerating(true);
            const cartonIds = new Set(cartons.map(c => c.id));
            const rowsSnapshot = await getDocs(query(collection(db, 'carton_rows')));

            const allRows = rowsSnapshot.docs
                .map(d => ({ id: d.id, ...d.data() } as CartonRow))
                .filter(r => r.cartonId && cartonIds.has(r.cartonId));

            const detailedCartons = cartons.map(c => ({
                ...c,
                rows: allRows.filter(r => r.cartonId === c.id)
            }));

            await generateCartonSheet(detailedCartons, season);
        } catch (e) {
            console.error("Error generating Carton Sheet:", e);
            alert("Error generating Carton Sheet.");
        } finally {
            setGenerating(false);
        }
    };

    const handleDeleteCarton = async (cartonId: string) => {
        const cartonToDelete = cartons.find(c => c.id === cartonId);
        if (!cartonToDelete) return;

        if (!confirm(`Delete Carton #${cartonToDelete.cartonNumber}? You can undo this for a few seconds.`)) return;

        try {
            setLoading(true);

            // 1. Fetch all rows before deleting
            const rowsQuery = query(collection(db, 'carton_rows'), where('cartonId', '==', cartonId));
            const rowsSnap = await getDocs(rowsQuery);
            const rowsData = rowsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // 2. Save to backup for Undo
            setLastDeleted({
                carton: { ...cartonToDelete },
                rows: rowsData
            });

            const batch = writeBatch(db);

            // 3. Delete Carton Doc
            batch.delete(doc(db, 'cartons', cartonId));

            // 4. Delete Associated Rows
            rowsSnap.forEach(rowDoc => {
                batch.delete(rowDoc.ref);
            });

            await batch.commit();
            
            // 5. Show Undo banner
            setShowUndo(true);
            setTimeout(() => setShowUndo(false), 8000); // Hide after 8 seconds
        } catch (e) {
            console.error("Error deleting carton:", e);
            alert("Failed to delete carton");
        } finally {
            setLoading(false);
        }
    };

    const handleUndoDelete = async () => {
        if (!lastDeleted) return;

        try {
            setLoading(true);
            const batch = writeBatch(db);

            // 1. Restore Carton
            const cartonRef = doc(db, 'cartons', lastDeleted.carton.id);
            const { id, ...cartonData } = lastDeleted.carton;
            batch.set(cartonRef, cartonData);

            // 2. Restore Rows
            lastDeleted.rows.forEach(row => {
                const rowRef = doc(db, 'carton_rows', row.id);
                const { id, ...rowData } = row;
                batch.set(rowRef, rowData);
            });

            await batch.commit();
            setLastDeleted(null);
            setShowUndo(false);
            alert("Carton restored successfully!");
        } catch (e) {
            console.error("Error restoring carton:", e);
            alert("Failed to restore carton.");
        } finally {
            setLoading(false);
        }
    };

    const totalPcs = cartons.reduce((acc, c) => acc + (c.totalPcs || 0), 0);
    const totalCartons = cartons.length;

    return (
        <>
            <div className="space-y-8">


            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <h2 className="text-2xl font-bold text-gray-900">Admin Dashboard</h2>
                <div className="flex gap-3">
                    {user?.role === 'admin' && (
                        <>
                            <button
                                onClick={handleNewExcelClick}
                                className="btn-primary flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white border-none"
                                title="Create New Excel File (Starts fresh list)"
                            >
                                <Plus size={18} /> NEW EXCEL SHEET
                            </button>
                            <button
                                onClick={handleDownloadPackingList}
                                disabled={generating || cartons.length === 0}
                                className="btn-secondary flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white border-none"
                                title="Download Packing List (Grouped by Store)"
                            >
                                {generating ? 'Generating...' : (
                                    <>
                                        <FileSpreadsheet size={18} /> Packing List Download
                                    </>
                                )}
                            </button>
                            <button
                                onClick={handleDownloadCartonSheet}
                                disabled={generating || cartons.length === 0}
                                className="btn-secondary flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white border-none"
                                title="Download Carton Sheet (Header Only)"
                            >
                                {generating ? 'Generating...' : (
                                    <>
                                        <FileSpreadsheet size={18} /> Carton Sheet
                                    </>
                                )}
                            </button>
                        </>
                    )}

                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex items-center gap-4">
                    <div className="p-3 bg-blue-50 rounded-lg text-blue-600">
                        <Package size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Total Cartons</p>
                        <p className="text-2xl font-bold text-gray-900">{totalCartons}</p>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex items-center gap-4">
                    <div className="p-3 bg-green-50 rounded-lg text-green-600">
                        <Layers size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Total Pieces</p>
                        <p className="text-2xl font-bold text-gray-900">{totalPcs.toLocaleString()}</p>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-purple-50 rounded text-purple-600">
                                <SettingsIcon size={16} />
                            </div>
                            <p className="text-sm font-medium text-gray-500">Current Season</p>
                        </div>
                        {isSeasonDirty && (
                            <button
                                onClick={handleSaveSeason}
                                className="text-xs font-bold text-blue-600 hover:text-blue-800"
                            >
                                SAVE
                            </button>
                        )}
                    </div>
                    <input
                        type="text"
                        className="w-full text-lg font-bold text-gray-900 border-none p-0 focus:ring-0 placeholder-gray-300"
                        value={tempSeason}
                        onChange={(e) => {
                            setTempSeason(e.target.value);
                            setIsSeasonDirty(e.target.value !== season);
                        }}
                    />
                </div>
            </div>

            {/* Store Targets & Analytics */}
            <StoreTargetsAnalytics cartons={cartons} />

            {/* Manage Dropdowns */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Manage Dropdowns</h3>
                    <div className="flex bg-gray-100 p-1 rounded-lg">
                        <button
                            onClick={() => setOptionType('print')}
                            className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${optionType === 'print' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Prints
                        </button>
                        <button
                            onClick={() => setOptionType('style')}
                            className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${optionType === 'style' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Styles
                        </button>
                        <button
                            onClick={() => setOptionType('store')}
                            className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${optionType === 'store' ? 'bg-white shadow text-green-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Stores
                        </button>
                    </div>
                </div>

                <div className="flex gap-2 mb-4">
                    <input
                        type="text"
                        placeholder={`New ${optionType === 'print' ? 'Print' : optionType === 'style' ? 'Style' : 'Store'} Name`}
                        className="input-field flex-1"
                        value={newOption}
                        onChange={(e) => setNewOption(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddOption()}
                    />
                    <button
                        onClick={handleAddOption}
                        className="btn-primary whitespace-nowrap"
                    >
                        <Plus size={16} className="inline mr-1" /> Add
                    </button>
                </div>

                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 bg-gray-50 rounded border border-gray-100">
                    {(optionType === 'print' ? dropdowns.prints : optionType === 'style' ? dropdowns.styles : (dropdowns.stores || [])).map(opt => (
                        <div key={opt} className={`bg-white px-3 py-1 rounded-full border text-sm flex items-center gap-2 group ${optionType === 'store' ? 'border-green-200 text-green-800' : 'border-gray-200'
                            }`}>
                            {opt}
                            {user?.role === 'admin' && (
                                <button
                                    onClick={() => handleDeleteOption(optionType, opt)}
                                    className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                    {(optionType === 'print' ? dropdowns.prints : optionType === 'style' ? dropdowns.styles : (dropdowns.stores || [])).length === 0 && (
                        <p className="text-gray-400 text-sm italic">No options found. {optionType === 'store' ? 'Add store names above.' : ''}</p>
                    )}
                </div>
            </div>

            {/* Manage Sizes */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Manage Sizes</h3>

                <div className="flex flex-wrap gap-4 items-end mb-6 bg-gray-50 p-4 rounded-lg border border-gray-100">
                    <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Size Label</label>
                        <input
                            type="text"
                            placeholder="e.g. 52, XL"
                            className="input-field w-32"
                            value={newSizeLabel}
                            onChange={(e) => {
                                setNewSizeLabel(e.target.value);
                                // Auto-detect type
                                setNewSizeType(isNaN(parseFloat(e.target.value.trim())) ? 'alpha' : 'numeric');
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddSizeConfig()}
                        />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Type (Auto)</label>
                        <select
                            className="input-field w-28"
                            value={newSizeType}
                            onChange={(e) => setNewSizeType(e.target.value as 'numeric' | 'alpha')}
                        >
                            <option value="numeric">Numeric</option>
                            <option value="alpha">Alpha</option>
                        </select>
                    </div>
                    <div className="flex flex-col justify-end">
                        <p className="text-xs text-gray-400 mb-1">Auto-sorted by value</p>
                        <button
                            onClick={handleAddSizeConfig}
                            className="btn-primary"
                        >
                            <Plus size={16} className="inline mr-1" /> Add Size
                        </button>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    {sizeList.map(size => (
                        <div key={size.id} className={`px-3 py-1 rounded-full border text-sm flex items-center gap-2 group ${size.type === 'numeric' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-purple-50 border-purple-200 text-purple-700'}`}>
                            <span className="font-bold">{size.label}</span>
                            <span className="text-[10px] opacity-70">({size.order})</span>
                            {user?.role === 'admin' && (
                                <button
                                    onClick={() => handleDeleteSizeConfig(size.id)}
                                    className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                    {sizeList.length === 0 && (
                        <p className="text-gray-400 text-sm italic">No sizes defined. System will use defaults or show nothing.</p>
                    )}
                </div>
            </div>

            {/* Cartons Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Recent Cartons</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="table-header">Store Name</th>
                                <th className="table-header">Buyer</th>
                                <th className="table-header">Measurement</th>
                                <th className="table-header text-right">Net Wt</th>
                                <th className="table-header text-right">Gross Wt</th>
                                <th className="table-header text-right">Total Pcs</th>
                                <th className="table-header">Season</th>
                                <th className="table-header">Created By</th>
                                <th className="table-header w-10">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {loading ? (
                                <tr><td colSpan={7} className="p-4 text-center text-gray-500">Loading...</td></tr>
                            ) : cartons.length === 0 ? (
                                <tr><td colSpan={7} className="p-4 text-center text-gray-500">No cartons found.</td></tr>
                            ) : (
                                cartons.map(carton => (
                                    <tr key={carton.id} className="hover:bg-gray-50">
                                        <td className="table-cell font-medium text-gray-900">{carton.storeName}</td>
                                        <td className="table-cell text-gray-500">{carton.buyer}</td>
                                        <td className="table-cell text-gray-500">{carton.measurement}</td>
                                        <td className="table-cell text-right text-gray-500">{carton.netWeight}</td>
                                        <td className="table-cell text-right text-gray-500">{carton.grossWeight}</td>
                                        <td className="table-cell text-right font-bold text-gray-900">{carton.totalPcs}</td>
                                        <td className="table-cell text-gray-500">{carton.season}</td>
                                        <td className="table-cell text-gray-500 text-xs">{carton.createdBy}</td>
                                        <td className="table-cell">
                                            {user?.role === 'admin' && (
                                                <div className="flex gap-1">
                                                    <button
                                                        onClick={() => {
                                                            setEditingCarton(carton);
                                                        }}
                                                        className="p-1 hover:bg-gray-100 rounded text-blue-600 transition-colors"
                                                        title="Edit Carton"
                                                    >
                                                        <Edit size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteCarton(carton.id)}
                                                        className="p-1 hover:bg-red-50 rounded text-red-600 transition-colors"
                                                        title="Delete Carton"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Edit Modal */}
            {editingCarton && (
                <EditCartonModal
                    carton={editingCarton}
                    onClose={() => setEditingCarton(null)}
                />
            )}

            {/* Password Modal */}
            {showPasswordModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4 animate-fadeIn">
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                            </div>
                            <h2 className="text-xl font-bold text-gray-900">Enter Password</h2>
                            <p className="text-sm text-gray-500 text-center">Password required to start a new Excel sheet.</p>
                            <input
                                type="password"
                                className={`w-full px-4 py-3 border-2 rounded-lg text-center text-xl tracking-widest font-mono focus:outline-none transition-colors ${passwordError
                                        ? 'border-red-400 bg-red-50 text-red-700 focus:border-red-500'
                                        : 'border-gray-300 focus:border-red-500'
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
                                    className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors"
                                >
                                    Confirm
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>

        {/* Undo Banner */}
        {showUndo && (
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="bg-gray-900 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-6 border border-gray-800">
                    <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-400">Carton Deleted</span>
                        <span className="text-xs text-gray-500">Deleted Carton #{lastDeleted?.carton?.cartonNumber}</span>
                    </div>
                    <div className="h-8 w-[1px] bg-gray-800"></div>
                    <button
                        onClick={handleUndoDelete}
                        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl transition-all font-bold text-sm"
                    >
                        <Undo2 size={16} />
                        UNDO
                    </button>
                    <button 
                        onClick={() => setShowUndo(false)}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>
        )}
        </>
    );
};

export default AdminPanel;
