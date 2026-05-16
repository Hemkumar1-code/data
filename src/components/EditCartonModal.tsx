import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, addDoc, query, where, onSnapshot, serverTimestamp, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { BUYER_OPTIONS } from '../types';
import type { Carton, SizeConfig } from '../types';
import { Plus, Trash2, Edit, X, Save } from 'lucide-react';

const MEASUREMENT_OPTIONS = [
    { value: '49 x 39 x 40', deduction: 1.1 },
    { value: '49 x 39 x 30', deduction: 0.900 },
    { value: '49 x 39 x 20', deduction: 0.700 },
];

interface RowInput {
    print: string;
    style: string;
    sizes: { [key: string]: string };
}

const INITIAL_ROW_STATE: RowInput = {
    print: '',
    style: '',
    sizes: {}
};

interface EditCartonModalProps {
    carton: Carton;
    onClose: () => void;
}

const EditCartonModal: React.FC<EditCartonModalProps> = ({ carton, onClose }) => {
    const { user } = useAuth();
    

    const [buyer, setBuyer] = useState(carton.buyer || BUYER_OPTIONS[0]);
    const [storeName, setStoreName] = useState(carton.storeName || '');
    const [season, setSeason] = useState(carton.season || '');
    const [netWeight, setNetWeight] = useState(carton.netWeight !== undefined ? String(carton.netWeight) : '');
    const [grossWeight, setGrossWeight] = useState(carton.grossWeight !== undefined ? String(carton.grossWeight) : '');
    const [measurement, setMeasurement] = useState(carton.measurement || '');


    const [currentRow, setCurrentRow] = useState<RowInput>(INITIAL_ROW_STATE);


    const [savedRows, setSavedRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [dropdowns, setDropdowns] = useState<{ prints: string[], styles: string[], stores: string[] }>({ prints: [], styles: [], stores: [] });
    const [sizeList, setSizeList] = useState<SizeConfig[]>([]);
    const [editingRowId, setEditingRowId] = useState<string | null>(null);


    useEffect(() => {
        const dropRef = doc(db, 'settings', 'dropdowns');
        const unsubDrops = onSnapshot(dropRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setDropdowns({
                    prints: data.prints || [],
                    styles: data.styles || [],
                    stores: data.stores || [],
                });
            }
        });

        const sizeRef = doc(db, 'settings', 'sizes');
        const unsubSizes = onSnapshot(sizeRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                const list = (data.list || []) as SizeConfig[];
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
            }
        });

        return () => {
            unsubDrops();
            unsubSizes();
        };
    }, []);


    useEffect(() => {
        if (!carton.id) return;

        const q = query(
            collection(db, 'carton_rows'),
            where('cartonId', '==', carton.id)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
           
            rows.sort((a: any, b: any) => {
                const aTime = a.createdAt?.seconds || 0;
                const bTime = b.createdAt?.seconds || 0;
                return aTime - bTime;
            });
            setSavedRows(rows);
            setLoading(false);
        });

        return unsubscribe;
    }, [carton.id]);

    const handleSizeChange = (size: string, value: string) => {
        if (value && !/^-?\d*$/.test(value)) return;
        setCurrentRow(prev => ({
            ...prev,
            sizes: { ...prev.sizes, [size]: value }
        }));
    };

    const calculateTotalPcs = (sizes: { [key: string]: string | number }) => {
        return Object.values(sizes).reduce((sum: number, val) => sum + (Number(val) || 0), 0);
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
        const total = calculateTotalPcs(currentRow.sizes);
        if (total === 0) {
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
                totalPcs: total,
                buyer,
                storeName,
                cartonId: carton.id,
                batchId: carton.batchId || null,
            };

            if (editingRowId) {
                await updateDoc(doc(db, 'carton_rows', editingRowId), {
                    ...rowData,
                    updatedAt: serverTimestamp()
                });
                setEditingRowId(null);
            } else {
                await addDoc(collection(db, 'carton_rows'), {
                    ...rowData,
                    createdBy: user.email,
                    createdAt: serverTimestamp(),
                });
            }
            setCurrentRow(INITIAL_ROW_STATE);
        } catch (error) {
            console.error("Error saving row:", error);
            alert("Failed to save row.");
        }
    };

    const deleteRow = async (id: string) => {
        if (confirm("Delete this row?")) {
            try {
                await deleteDoc(doc(db, 'carton_rows', id));
            } catch (error) {
                console.error("Error deleting row:", error);
                alert("Failed to delete row.");
            }
        }
    };

    const handleSaveChanges = async () => {
        if (!storeName || !netWeight || !grossWeight || !measurement || !season) {
            alert("Please fill in all Carton Details.");
            return;
        }

        try {

            const newTotalPcs = savedRows.reduce((sum, row) => sum + (row.totalPcs || 0), 0);
            

            let adminSizesTotal = 0;
            if (carton.sizes) {
                adminSizesTotal = Object.values(carton.sizes).reduce((sum, val) => sum + Number(val), 0);
            }

            const finalTotalPcs = newTotalPcs + adminSizesTotal;

            const cartonRef = doc(db, 'cartons', carton.id);
            await updateDoc(cartonRef, {
                buyer,
                storeName,
                season,
                netWeight: Number(netWeight),
                grossWeight: Number(grossWeight),
                measurement,
                totalPcs: finalTotalPcs,
                updatedAt: serverTimestamp()
            });


            for (const row of savedRows) {
                await updateDoc(doc(db, 'carton_rows', row.id), {
                    buyer,
                    storeName,
                });
            }

            alert("Carton updated successfully!");
            onClose();
        } catch (error) {
            console.error("Error updating carton:", error);
            alert("Failed to update carton.");
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 sm:p-6 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[95vh] flex flex-col my-auto overflow-hidden animate-fadeIn">
 

                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 shrink-0">
                    <div>
                        <h2 className="font-bold text-xl text-gray-900 flex items-center gap-2">
                            <Edit size={20} className="text-blue-600" />
                            Edit Carton #{carton.index || 'N/A'}
                        </h2>
                        <p className="text-xs text-gray-500 mt-1">ID: {carton.id}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                        <X size={20} className="text-gray-500" />
                    </button>
                </div>


                <div className="p-6 overflow-y-auto space-y-6 flex-1">
                    

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Season <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                className="input-field bg-gray-50 border-gray-300"
                                value={season}
                                onChange={(e) => setSeason(e.target.value)}
                            />
                        </div>
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


                    <div className="bg-blue-50/30 p-5 rounded-xl border border-blue-100">
                        <h3 className="text-sm font-semibold text-blue-900 uppercase tracking-wider mb-4">Carton Dimensions & Weight</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Measurement (cm)</label>
                                <select
                                    value={measurement}
                                    onChange={(e) => setMeasurement(e.target.value)}
                                    className="input-field bg-white"
                                >
                                    <option value="">Select Measurement</option>
                                    {MEASUREMENT_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.value}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Gross Weight (Kg)</label>
                                <input
                                    type="number"
                                    step="0.001"
                                    value={grossWeight}
                                    onChange={(e) => {
                                        const gross = parseFloat(e.target.value);
                                        setGrossWeight(e.target.value);
                                        const selectedOpt = MEASUREMENT_OPTIONS.find(o => o.value === measurement);
                                        if (selectedOpt && !isNaN(gross)) {
                                            const net = gross - selectedOpt.deduction;
                                            setNetWeight(net >= 0 ? net.toFixed(3) : '0.000');
                                        } else {
                                            setNetWeight('');
                                        }
                                    }}
                                    placeholder="e.g. 10"
                                    className="input-field bg-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Net Weight (Kg)</label>
                                <input
                                    type="number"
                                    step="0.001"
                                    value={netWeight}
                                    onChange={(e) => setNetWeight(e.target.value)}
                                    placeholder="Net Weight"
                                    className="input-field bg-white"
                                />
                            </div>
                        </div>
                    </div>


                    <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                            <h3 className="font-semibold text-gray-800">Carton Contents</h3>
                            <span className="text-sm text-gray-500">{savedRows.length} rows</span>
                        </div>
                        <div className="overflow-x-auto max-h-[40vh] overflow-y-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-white sticky top-0 z-20 shadow-sm">
                                    <tr>
                                        <th className="table-header bg-white sticky left-0 z-30 shadow-[1px_0_0_0_#e5e7eb]">Print</th>
                                        <th className="table-header bg-white sticky left-[120px] z-30 shadow-[1px_0_0_0_#e5e7eb]">Style</th>
                                        {sizeList.map(size => (
                                            <th key={size.id} className="table-header text-center w-16 px-1">
                                                <span>{size.label}</span>
                                            </th>
                                        ))}
                                        <th className="table-header text-right">Total</th>
                                        <th className="table-header text-center w-20">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-100">
                                    {loading && (
                                        <tr><td colSpan={(sizeList.length || 10) + 4} className="p-8 text-center text-gray-500">Loading rows...</td></tr>
                                    )}


                                    {savedRows.map(row => (
                                        <tr key={row.id} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="table-cell sticky left-0 bg-white shadow-[1px_0_0_0_#e5e7eb] font-medium text-gray-700">{row.print}</td>
                                            <td className="table-cell sticky left-[120px] bg-white shadow-[1px_0_0_0_#e5e7eb] font-medium text-gray-700">{row.style}</td>
                                            {sizeList.map(size => (
                                                <td key={size.id} className="table-cell text-center text-gray-500">
                                                    {row.sizes[size.label] || '-'}
                                                </td>
                                            ))}
                                            <td className="table-cell text-right font-bold text-gray-800">{row.totalPcs}</td>
                                            <td className="table-cell text-center">
                                                <div className="flex justify-center gap-1">
                                                    <button onClick={() => handleEditRow(row)} className="text-blue-500 hover:text-blue-700 p-1.5 rounded hover:bg-blue-50" title="Edit">
                                                        <Edit size={16} />
                                                    </button>
                                                    <button onClick={() => deleteRow(row.id)} className="text-red-500 hover:text-red-700 p-1.5 rounded hover:bg-red-50" title="Delete">
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}

                                    {/* Input Row */}
                                    <tr className={`bg-blue-50/30 ${editingRowId ? 'ring-2 ring-blue-400 ring-inset' : ''}`}>
                                        <td className="p-2 sticky left-0 bg-blue-50/90 z-10 shadow-[1px_0_0_0_#e5e7eb] min-w-[120px]">
                                            <select
                                                className="w-full px-2 py-1.5 border border-blue-200 rounded text-sm bg-white"
                                                value={currentRow.print}
                                                onChange={(e) => setCurrentRow(prev => ({ ...prev, print: e.target.value }))}
                                            >
                                                <option value="">Select</option>
                                                {dropdowns.prints.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                            </select>
                                        </td>
                                        <td className="p-2 sticky left-[120px] bg-blue-50/90 z-10 shadow-[1px_0_0_0_#e5e7eb] min-w-[120px]">
                                            <select
                                                className="w-full px-2 py-1.5 border border-blue-200 rounded text-sm bg-white"
                                                value={currentRow.style}
                                                onChange={(e) => {
                                                    const newStyle = e.target.value;
                                                    setCurrentRow(prev => {
                                                        const doubleStyles = ['baggy pants', 'baggy pant', 'pants', 'pant', 'short pants', 'short pant', 'terry short pants', 'terry short pant'];
                                                        const isOldDouble = prev.style ? doubleStyles.includes(prev.style.toLowerCase().trim()) : false;
                                                        const isNewDouble = newStyle ? doubleStyles.includes(newStyle.toLowerCase().trim()) : false;
                                                        return { ...prev, style: newStyle, sizes: isOldDouble !== isNewDouble ? {} : prev.sizes };
                                                    });
                                                }}
                                            >
                                                <option value="">Select</option>
                                                {dropdowns.styles.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                            </select>
                                        </td>
                                        {sizeList.map(size => {
                                            const doubleStyles = ['baggy pants', 'baggy pant', 'pants', 'pant', 'short pants', 'short pant', 'terry short pants', 'terry short pant'];
                                            const isDoubleSizeStyle = currentRow.style ? doubleStyles.includes(currentRow.style.toLowerCase().trim()) : false;
                                            const isDoubleSize = size.label.includes('/');
                                            const isDisabled = currentRow.style ? (isDoubleSizeStyle ? !isDoubleSize : isDoubleSize) : false;
                                            
                                            return (
                                                <td key={size.id} className="p-2 text-center">
                                                    <input
                                                        type="text"
                                                        disabled={isDisabled}
                                                        className={`w-12 px-1 py-1.5 border rounded text-center text-sm focus:ring-1 focus:ring-blue-500 outline-none ${
                                                            isDisabled ? 'bg-gray-100 opacity-50 cursor-not-allowed border-gray-200' : 
                                                            currentRow.sizes[size.label]
                                                                ? Number(currentRow.sizes[size.label]) < 0
                                                                    ? 'border-red-400 bg-red-50 text-red-700'
                                                                    : 'border-blue-400 bg-blue-50 text-blue-900'
                                                                : 'border-gray-200 bg-white'
                                                        }`}
                                                        value={currentRow.sizes[size.label] || ''}
                                                        onChange={(e) => handleSizeChange(size.label, e.target.value)}
                                                    />
                                                </td>
                                            );
                                        })}
                                        <td className="p-2 text-right font-bold text-blue-700">
                                            {calculateTotalPcs(currentRow.sizes)}
                                        </td>
                                        <td className="p-2 text-center">
                                            {editingRowId ? (
                                                <div className="flex gap-1 justify-center">
                                                    <button onClick={handleSaveRow} className="bg-blue-600 hover:bg-blue-700 text-white p-1.5 rounded transition-colors" title="Update">
                                                        <Save size={16} />
                                                    </button>
                                                    <button onClick={handleCancelEdit} className="bg-gray-400 hover:bg-gray-500 text-white p-1.5 rounded transition-colors" title="Cancel">
                                                        <X size={16} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button onClick={handleSaveRow} className="bg-green-600 hover:bg-green-700 text-white p-1.5 px-3 rounded text-sm font-medium transition-colors w-full flex items-center justify-center gap-1">
                                                    <Plus size={16} /> Add
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3 shrink-0">
                    <button onClick={onClose} className="px-5 py-2 text-gray-700 font-medium hover:bg-gray-200 rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button onClick={handleSaveChanges} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm flex items-center gap-2 transition-colors">
                        <Save size={18} />
                        Save All Changes
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EditCartonModal;
