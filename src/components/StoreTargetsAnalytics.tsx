import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Upload, Trash2, BarChart2, PieChart as PieChartIcon } from 'lucide-react';
import type { Carton } from '../types';

interface StoreTarget {
    storeName: string;
    targetQty: number;
}

interface StoreTargetsAnalyticsProps {
    cartons: Carton[];
}


const StoreTargetsAnalytics: React.FC<StoreTargetsAnalyticsProps> = ({ cartons }) => {
    const [targets, setTargets] = useState<StoreTarget[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedStore, setSelectedStore] = useState<string>('OVERALL');

    useEffect(() => {
        const docRef = doc(db, 'settings', 'store_targets');
        const unsub = onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
                setTargets(snap.data().list || []);
            } else {
                setTargets([]);
            }
            setLoading(false);
        }, (error) => {
            console.error("Firebase target fetch error:", error);
            setLoading(false);
        });
        return unsub;
    }, []);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const arrayBuffer = evt.target?.result as ArrayBuffer;
                const wb = XLSX.read(arrayBuffer, { type: 'array' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

                if (rows.length === 0) {
                    alert("The Excel file is empty!");
                    return;
                }

                const newTargets: StoreTarget[] = [];
                
                // Smart Auto-Detect: Scan every row for a (String, Number) pair
                rows.forEach((row) => {
                    if (!Array.isArray(row) || row.length < 2) return;

                    let possibleStore = "";
                    let possibleQty = -1;

                    // Iterate through cells to find a Name and a Number
                    for (let j = 0; j < row.length; j++) {
                        const cell = row[j];
                        if (cell === null || cell === undefined || cell === '') continue;

                        const strVal = String(cell).trim();
                        const numVal = Number(String(cell).replace(/,/g, ''));

                        // If it's a number and not already found a qty
                        if (!isNaN(numVal) && typeof cell !== 'boolean' && possibleQty === -1) {
                            possibleQty = numVal;
                        } 
                        // If it's a string (not a number) and not already found a store
                        else if (isNaN(numVal) && strVal.length > 1 && possibleStore === "") {
                            // Ignore common header words
                            const lower = strVal.toLowerCase();
                            if (lower !== 'store name' && lower !== 'store' && lower !== 'qty' && lower !== 'quantity' && lower !== 'total') {
                                possibleStore = strVal;
                            }
                        }
                    }

                    if (possibleStore !== "" && possibleQty !== -1) {
                        newTargets.push({ storeName: possibleStore, targetQty: possibleQty });
                    }
                });

                if (newTargets.length === 0) {
                    alert("Could not find any valid data rows.\n\nPlease ensure your Excel has:\n1. Store Names in one column\n2. Quantities (Numbers) in another column");
                    return;
                }

                await setDoc(doc(db, 'settings', 'store_targets'), { list: newTargets });
                alert(`Success! Saved targets for ${newTargets.length} stores.`);
            } catch (error) {
                console.error("Error reading file:", error);
                alert("Failed to parse Excel file. Check your internet connection or console for details.");
            }

            e.target.value = '';
        };
        reader.readAsArrayBuffer(file);
    };

    const handleDeleteTargets = async () => {
        if (!confirm("Are you sure you want to delete the uploaded targets?")) return;
        try {
            await deleteDoc(doc(db, 'settings', 'store_targets'));
            setSelectedStore('OVERALL');
        } catch (error) {
            console.error("Error deleting targets:", error);
            alert("Failed to delete.");
        }
    };

    // Normalize store name: remove ALL spaces + uppercase so "LITTLE LUNA A" and "LITTLELUNA A" both match
    const normalizeName = (name: string) => name.trim().replace(/\s+/g, '').toUpperCase();

    // Calculate aggregated packed quantities (keyed by NORMALIZED store name)
    const packedQuantities = useMemo(() => {
        const map: Record<string, number> = {};
        cartons.forEach(c => {
            const store = normalizeName(c.storeName);
            map[store] = (map[store] || 0) + (c.totalPcs || 0);
        });
        return map;
    }, [cartons]);

    // Data for Chart
    const chartData = useMemo(() => {
        if (selectedStore === 'OVERALL') {
            const totalTarget = targets.reduce((sum, t) => sum + t.targetQty, 0);
            // ✅ Sum ALL packed pieces from all cartons
            const totalPacked = Object.values(packedQuantities).reduce((sum, qty) => sum + qty, 0);

            if (totalTarget === 0) return [];

            const pending = Math.max(0, totalTarget - totalPacked);
            const overPacked = Math.max(0, totalPacked - totalTarget);

            if (overPacked > 0) {
                return [
                    { name: 'Target Achieved', value: totalTarget, color: '#10B981' },
                    { name: 'Over Packed', value: overPacked, color: '#EF4444' }
                ];
            }

            return [
                { name: 'Packed', value: totalPacked, color: '#10B981' },
                { name: 'Pending', value: pending, color: '#E5E7EB' }
            ];
        } else {
            const target = targets.find(t => normalizeName(t.storeName) === normalizeName(selectedStore));
            if (!target) return [];

            const targetQty = target.targetQty;
            // ✅ Lookup using normalized name to handle space differences
            const packed = packedQuantities[normalizeName(selectedStore)] || 0;
            const pending = Math.max(0, targetQty - packed);
            const overPacked = Math.max(0, packed - targetQty);

            if (overPacked > 0) {
                return [
                    { name: 'Target Achieved', value: targetQty, color: '#10B981' },
                    { name: 'Over Packed', value: overPacked, color: '#EF4444' }
                ];
            }

            return [
                { name: 'Packed', value: packed, color: '#10B981' },
                { name: 'Pending', value: pending, color: '#E5E7EB' }
            ];
        }
    }, [targets, packedQuantities, selectedStore]);

    // Calculate daily progress (Last 7 days)
    const dailyData = useMemo(() => {
        const last7Days: string[] = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            last7Days.push(d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));
        }

        const map: Record<string, number> = {};
        cartons.forEach(c => {
            if (c.createdAt) {
                // Handle both Firestore Timestamp and regular Date
                const dateObj = (c.createdAt as any).seconds 
                    ? new Date((c.createdAt as any).seconds * 1000) 
                    : new Date(c.createdAt);
                
                const dateStr = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                map[dateStr] = (map[dateStr] || 0) + (c.totalPcs || 0);
            }
        });

        return last7Days.map(date => ({
            date,
            pieces: map[date] || 0
        }));
    }, [cartons]);


    const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index, name }: any) => {
        const RADIAN = Math.PI / 180;
        const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
        const x = cx + radius * Math.cos(-midAngle * RADIAN);
        const y = cy + radius * Math.sin(-midAngle * RADIAN);

        if (percent === 0) return null;

        return (
            <text x={x} y={y} fill={index === 1 && name === 'Pending' ? '#6B7280' : 'white'} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" className="text-xs font-bold">
                {`${(percent * 100).toFixed(0)}%`}
            </text>
        );
    };

    if (loading) return <div className="p-4 text-gray-500">Loading targets...</div>;

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                        <PieChartIcon size={20} />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">Value of Store Analytics</h3>
                </div>

                {targets.length > 0 && (
                    <button
                        onClick={handleDeleteTargets}
                        className="btn-primary bg-red-50 text-red-600 hover:bg-red-100 border-none flex items-center gap-2"
                    >
                        <Trash2 size={16} /> Delete Excel Data
                    </button>
                )}
            </div>

            {targets.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-10 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50">
                    <Upload size={48} className="text-gray-400 mb-4" />
                    <h4 className="text-gray-900 font-semibold mb-2">Upload Store Targets (Excel)</h4>
                    <p className="text-sm text-gray-500 mb-6 max-w-md text-center">
                        Upload an Excel file containing two columns: <strong className="text-gray-700">Store Name</strong> and <strong className="text-gray-700">Qty</strong>.
                    </p>
                    <label className="btn-primary cursor-pointer">
                        <span>Select Excel File</span>
                        <input
                            type="file"
                            accept=".xlsx, .xls"
                            className="hidden"
                            onChange={handleFileUpload}
                        />
                    </label>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Controls & Data */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Select View</label>
                        <select
                            className="input-field w-full mb-6 font-medium bg-gray-50"
                            value={selectedStore}
                            onChange={(e) => setSelectedStore(e.target.value)}
                        >
                            <option value="OVERALL">📊 OVERALL (All Stores)</option>
                            {targets.map(t => (
                                <option key={t.storeName} value={t.storeName}>
                                    🏬 {t.storeName}
                                </option>
                            ))}
                        </select>

                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                            {selectedStore === 'OVERALL' ? (() => {
                                const totalTarget = targets.reduce((sum, t) => sum + t.targetQty, 0);
                                // ✅ Sum ALL packed pieces from all cartons
                                const totalPacked = Object.values(packedQuantities).reduce((sum, qty) => sum + qty, 0);
                                return (
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                                            <span className="text-gray-600 font-medium">Total Target Qty:</span>
                                            <span className="text-xl font-bold text-gray-900">{totalTarget.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                                            <span className="text-gray-600 font-medium">Total Packed:</span>
                                            <span className="text-xl font-bold text-green-600">{totalPacked.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-600 font-medium">Remaining / Status:</span>
                                            {totalPacked > totalTarget ? (
                                                <span className="text-lg font-bold text-red-500">Over by {(totalPacked - totalTarget).toLocaleString()}</span>
                                            ) : (
                                                <span className="text-lg font-bold text-gray-500">{(totalTarget - totalPacked).toLocaleString()} pending</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })() : (() => {
                                const target = targets.find(t => normalizeName(t.storeName) === normalizeName(selectedStore));
                                if (!target) return null;
                                const targetQty = target.targetQty;
                                // ✅ Lookup using normalized name to handle space differences
                                const packed = packedQuantities[normalizeName(selectedStore)] || 0;
                                return (
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                                            <span className="text-gray-600 font-medium">Store Target Qty:</span>
                                            <span className="text-xl font-bold text-gray-900">{targetQty.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                                            <span className="text-gray-600 font-medium">Packed for Store:</span>
                                            <span className="text-xl font-bold text-green-600">{packed.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-600 font-medium">Remaining / Status:</span>
                                            {packed > targetQty ? (
                                                <span className="text-lg font-bold text-red-500">Over by {(packed - targetQty).toLocaleString()}</span>
                                            ) : (
                                                <span className="text-lg font-bold text-gray-500">{(targetQty - packed).toLocaleString()} pending</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Chart Area */}
                    <div className="h-[300px] flex flex-col items-center justify-center bg-white border border-gray-100 rounded-xl">
                        {chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={chartData}
                                        cx="50%"
                                        cy="50%"
                                        labelLine={false}
                                        label={renderCustomizedLabel}
                                        outerRadius={100}
                                        dataKey="value"
                                        stroke="none"
                                    >
                                        {chartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        formatter={(value: any) => Number(value).toLocaleString()}
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Legend verticalAlign="bottom" height={36} />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <p className="text-gray-400 font-medium">No data to display</p>
                        )}
                    </div>
                </div>
            )}

            {/* Daily Progress Bar Chart */}
            <div className="mt-8 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-2 mb-6">
                    <div className="p-2 bg-green-50 rounded-lg text-green-600">
                        <BarChart2 size={20} />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">Daily Packing Progress (Last 7 Days)</h3>
                </div>

                <div className="h-[200px] w-full bg-white p-4 rounded-xl border border-gray-50">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dailyData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                            <XAxis 
                                dataKey="date" 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{ fill: '#6B7280', fontSize: 12 }}
                                dy={10}
                            />
                            <YAxis 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{ fill: '#6B7280', fontSize: 12 }}
                                tickFormatter={(val) => val.toLocaleString()}
                            />
                            <Tooltip 
                                cursor={{ fill: '#F9FAFB' }}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                formatter={(value: any) => [Number(value).toLocaleString(), 'Pieces']}
                            />
                            <Bar 
                                dataKey="pieces" 
                                fill="#10B981" 
                                radius={[6, 6, 0, 0]} 
                                barSize={40}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
};

export default StoreTargetsAnalytics;
