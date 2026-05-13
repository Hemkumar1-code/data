import type { Carton } from '../types';

// Standard size order for sorting
const STANDARD_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL"];

export const generateExcel = async (cartons: Carton[], season: string) => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    // 1. DYNAMIC SIZE DISCOVERY
    // Collect ALL unique size keys from ALL cartons (both rows and admin-added sizes)
    const allSizeKeys = new Set<string>();

    cartons.forEach(carton => {
        // Check rows
        carton.rows.forEach(row => {
            if (row.sizes) {
                Object.keys(row.sizes).forEach(size => allSizeKeys.add(size));
            }
        });
        if (carton.sizes) {
            Object.keys(carton.sizes).forEach(size => allSizeKeys.add(size));
        }
    });

    // 2. INTELLIGENT SORTING
    const sortedSizeColumns = Array.from(allSizeKeys).sort((a, b) => {
        // Helper to check if string is numeric
        const isNumA = !isNaN(Number(a));
        const isNumB = !isNaN(Number(b));

        // Group 1: Numerics (Sorted by value)
        if (isNumA && isNumB) {
            return Number(a) - Number(b);
        }
        if (isNumA) return -1;
        if (isNumB) return 1;
        const indexA = STANDARD_ORDER.indexOf(a.toUpperCase());
        const indexB = STANDARD_ORDER.indexOf(b.toUpperCase());

        if (indexA !== -1 && indexB !== -1) {
            return indexA - indexB;
        }
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.localeCompare(b);
    });

    console.log("Dynamic Size Columns:", sortedSizeColumns);
    const sortedCartons = [...cartons].sort((a, b) =>
        (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
    );

    const totalCartons = sortedCartons.length;

    sortedCartons.forEach((carton, index) => {
        const sheetName = `Carton ${index + 1}`;

        // Group Rows by Print + Style
        const groupedRows: { [key: string]: any } = {};
        carton.rows.forEach(row => {
            const key = `${row.print}|${row.style}`;
            if (!groupedRows[key]) {
                groupedRows[key] = {
                    print: row.print,
                    style: row.style,
                    sizes: { ...row.sizes },
                    totalPcs: row.totalPcs || 0
                };
            } else {
                // Merge sizes
                Object.entries(row.sizes).forEach(([size, qty]) => {
                    const current = Number(groupedRows[key].sizes[size] || 0);
                    const add = Number(qty || 0);
                    groupedRows[key].sizes[size] = current + add;
                });
                groupedRows[key].totalPcs += (row.totalPcs || 0);
            }
        });
        const finalRows = Object.values(groupedRows);

        const uniquePrints = Array.from(new Set(finalRows.map(r => r.print).filter(Boolean)));
        const uniqueStyles = Array.from(new Set(finalRows.map(r => r.style).filter(Boolean)));

        const cartonNoVal = `${index + 1} OF ${totalCartons}`;
        // Logic: If count > 1 -> "ALL COLOURS", else show name
        const colourVal = uniquePrints.length > 1 ? "ALL COLOURS" : (uniquePrints[0] || "");
        const styleVal = uniqueStyles.length > 1 ? "ALL STYLES" : (uniqueStyles[0] || "");

        const data: any[][] = [];

        // Fixed Header Structure
        data.push(["CARTON No", ":", cartonNoVal]);
        data.push(["SEASON", ":", season]);
        data.push(["STORE NAME", ":", carton.storeName]);
        data.push(["COLOUR", ":", colourVal]);
        data.push(["STYLE", ":", styleVal]);
        data.push(["TOTAL PCS", ":", carton.totalPcs]); // Carton Scope Total
        data.push(["NET WEIGHT", ":", carton.netWeight ? carton.netWeight + " Kg" : ""]);
        data.push(["GROSS WEIGHT", ":", carton.grossWeight ? carton.grossWeight + " Kg" : ""]);
        data.push(["CARTON DIMENSION", ":", carton.measurement]);
        data.push(["MADE IN INDIA"]);



        const ws = XLSX.utils.aoa_to_sheet(data);

        // Basic width
        const wscols = [
            { wch: 20 },
            { wch: 25 },
            // Add widths for size columns? roughly 5 chars
            ...sortedSizeColumns.map(() => ({ wch: 6 })),
            { wch: 10 }
        ];
        ws['!cols'] = wscols;

        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    XLSX.writeFile(wb, `Cartons_Export_${new Date().toISOString().slice(0, 10)}.xlsx`);
};


// --- PACKING LIST GENERATOR (DYNAMIC SIZE LAYOUT) ---

// Helper to normalize store name (remove suffixes)
const normalizeStoreName = (name: string) => {
    if (!name) return "Unknown";
    // Heuristic: remove suffixes like -A, -B, -ANSUN, -1
    return name.replace(/[-_](A|B|C|ANSUN|\d+)$/i, '').trim();
};

export const generatePackingList = async (cartons: Carton[]) => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    // --- 1. DYNAMIC SIZE DISCOVERY AND SORTING ---
    const allSizeKeys = new Set<string>();
    cartons.forEach(carton => {
        carton.rows.forEach(row => {
            if (row.sizes) Object.keys(row.sizes).forEach(size => allSizeKeys.add(size));
        });
        if (carton.sizes) Object.keys(carton.sizes).forEach(size => allSizeKeys.add(size));
    });

    const sortedSizeList = Array.from(allSizeKeys).sort((a, b) => {
        // Smart sort: split by slash to handle dual sizes like "50/56"
        const getBaseNum = (str: string) => {
            const parts = str.split('/');
            return parseFloat(parts[0]);
        };
        const aNum = getBaseNum(a);
        const bNum = getBaseNum(b);
        const aIsNum = !isNaN(aNum);
        const bIsNum = !isNaN(bNum);
        
        if (aIsNum && bIsNum) return aNum - bNum;
        if (aIsNum) return -1;
        if (bIsNum) return 1;
        return a.localeCompare(b);
    });

    const DYNAMIC_SIZE_MAP: { [key: string]: number } = {};
    let currentSizeCol = 3; // Starts at D
    sortedSizeList.forEach(size => {
        DYNAMIC_SIZE_MAP[size] = currentSizeCol++;
    });

    const COL_CTN_NO = 0;   // A
    const COL_STYLE = 1;    // B
    const COL_COLOUR = 2;   // C
    // 3 to currentSizeCol-1 are Sizes
    const COL_TOT_PCS = currentSizeCol; 
    const COL_NT_WT = currentSizeCol + 1;   
    const COL_GR_WT = currentSizeCol + 2;   
    const COL_CTN_DIMN = currentSizeCol + 3;
    const LAST_COL = currentSizeCol + 3;

    // 2. Group by Base Store
    const baseStoreGroups: { [base: string]: { [variant: string]: Carton[] } } = {};

    cartons.forEach(c => {
        const fullStoreName = c.storeName || "Unknown";
        const baseName = normalizeStoreName(fullStoreName);

        if (!baseStoreGroups[baseName]) baseStoreGroups[baseName] = {};
        if (!baseStoreGroups[baseName][fullStoreName]) baseStoreGroups[baseName][fullStoreName] = [];

        baseStoreGroups[baseName][fullStoreName].push(c);
    });

    // 2. Process each Base Store (One Sheet)
    Object.keys(baseStoreGroups).forEach(baseName => {
        const variants = baseStoreGroups[baseName];

        // Prepare Sheet Data Grid
        const wsData: any[][] = [];
        for (let i = 0; i < 200; i++) wsData.push(new Array(LAST_COL + 5).fill(""));

        // --- HEADERS (FIXED) ---
        // A1:AL1 Merged PACKING LIST (Index 0, Col 0-37)
        wsData[0][0] = "PACKING LIST";

        // Exporter Block (B3, C3-C7)
        // Row 2 (Index 2)
        wsData[2][1] = "Exporter"; // B3
        wsData[2][2] = "M/s. Sree Kanaga Durgaa Textile"; // C3
        wsData[3][2] = "22/41, Muthusamy, 4th Street,"; // C4
        wsData[4][2] = "Odakaddu,"; // C5
        wsData[5][2] = "Tirupur 641602"; // C6
        wsData[6][2] = "Tamilnadu, INDIA"; // C7

        // Fabric Block (I3:J7 Merged => Index 8:9, Row 2:6)
        wsData[2][8] = "Fabric : 100%\nOrganic Cotton\nKnitted";

        // Buyer Info Block (K3-M7)
        // K=10, L=11, M=12
        const firstVariant = Object.values(variants)[0];
        const firstCarton = firstVariant[0];

        wsData[2][10] = "Buyer :"; // K3
        wsData[2][11] = firstCarton?.buyer || ""; // L3

        wsData[3][10] = "Season :"; // K4
        wsData[3][11] = firstCarton?.season || ""; // L4

        wsData[4][10] = "Date :"; // K5
        wsData[4][11] = ""; // L5 Empty

        wsData[5][10] = "Order Qty :"; // K6
        wsData[5][11] = "";

        wsData[6][10] = "Destination :"; // K7
        wsData[6][11] = ""; // User Input (Empty)

        // Invoice Details (N3-N5) // N=13
        wsData[2][13] = "Invoice No :"; // N3
        wsData[3][13] = "Invoice Date :"; // N4
        wsData[4][13] = "Total Pcs/Sets :"; // N5

        // --- DIMENSION SUMMARY ---
        // K9:M9 Merged "CTN Dimension" (Row 8, Col 10-12)
        wsData[8][10] = "CTN Dimension";

        // Calculate Dimensions (N9 onward)
        const dimensionCounts: { [dim: string]: number } = {};
        Object.values(variants).flat().forEach(c => {
            const dim = c.measurement;
            if (dim) dimensionCounts[dim] = (dimensionCounts[dim] || 0) + 1;
        });

        // Start N9 (Row 8, Col 13)
        Object.entries(dimensionCounts).forEach(([dim, count], i) => {
            const r = 8 + i;
            if (wsData[r]) wsData[r][13] = `${dim} - ${count} CTNS`;
        });

        // --- TABLE STRUCTURE ---
        // Header Row starts at Row 12 (Index 11)

        const headerRowIdx = 11; // Row 12

        // Set Table Headers
        wsData[headerRowIdx][COL_CTN_NO] = "CTN.NO";
        wsData[headerRowIdx][COL_STYLE] = "STYLE";
        wsData[headerRowIdx][COL_COLOUR] = "COLOUR";

        Object.entries(DYNAMIC_SIZE_MAP).forEach(([label, colIdx]) => {
            wsData[headerRowIdx][colIdx] = label;
        });

        wsData[headerRowIdx][COL_TOT_PCS] = "TOT PCS";
        wsData[headerRowIdx][COL_NT_WT] = "NT WT";
        wsData[headerRowIdx][COL_GR_WT] = "GR WT";
        wsData[headerRowIdx][COL_CTN_DIMN] = "CTN DIMN";

        // --- DATA ROWS ---
        let currentRowIdx = 12; // Start at Row 13 (Data)
        let globalCtnCounter = 1;

        // Iterate Variants sorted
        Object.keys(variants).sort().forEach((variantName, vIdx) => {
            const variantCartons = variants[variantName];
            variantCartons.sort((a, b) => (a.index || 0) - (b.index || 0));

            // STORE NAME HEADER (A-AL Merged)
            // If vIdx == 0, Place at Row 10 (Index 9).
            if (vIdx === 0) {
                wsData[9][0] = `STORE NAME : ${variantName}`;
            } else {
                // Insert spacer row?
                currentRowIdx++;
                // Ensure buffer
                if (!wsData[currentRowIdx]) wsData.push(new Array(LAST_COL + 5).fill(""));
                // Insert Store Header
                wsData[currentRowIdx][0] = `STORE NAME : ${variantName}`;
                // Increment idx to start data
                currentRowIdx++;
            }

            // Data
            variantCartons.forEach(carton => {
                const uniqueRows = carton.rows;
                while (wsData.length <= currentRowIdx + uniqueRows.length + 5) wsData.push(new Array(LAST_COL + 5).fill(""));

                if (uniqueRows.length === 0) {
                    wsData[currentRowIdx][COL_CTN_NO] = globalCtnCounter++;
                    wsData[currentRowIdx][COL_TOT_PCS] = carton.totalPcs;
                    wsData[currentRowIdx][COL_NT_WT] = carton.netWeight;
                    wsData[currentRowIdx][COL_GR_WT] = carton.grossWeight;
                    wsData[currentRowIdx][COL_CTN_DIMN] = carton.measurement;
                    currentRowIdx++;
                } else {
                    uniqueRows.forEach((r, rIdx) => {
                        const isFirst = rIdx === 0;

                        wsData[currentRowIdx][COL_CTN_NO] = isFirst ? globalCtnCounter : "";
                        wsData[currentRowIdx][COL_STYLE] = r.style;
                        wsData[currentRowIdx][COL_COLOUR] = r.print;

                        if (r.sizes) {
                            Object.entries(r.sizes).forEach(([sizeKey, val]) => {
                                let num = Number(val);
                                const colIdx = DYNAMIC_SIZE_MAP[sizeKey];
                                if (colIdx && !isNaN(num) && num > 0) {
                                    wsData[currentRowIdx][colIdx] = num;
                                }
                            });
                        }

                        wsData[currentRowIdx][COL_TOT_PCS] = r.totalPcs || "";
                        wsData[currentRowIdx][COL_NT_WT] = isFirst ? carton.netWeight : "";
                        wsData[currentRowIdx][COL_GR_WT] = isFirst ? carton.grossWeight : "";
                        wsData[currentRowIdx][COL_CTN_DIMN] = isFirst ? carton.measurement : "";

                        currentRowIdx++;
                    });
                    globalCtnCounter++;
                }
            });
        });

        // Trim
        const finalData = wsData.slice(0, currentRowIdx);
        const ws = XLSX.utils.aoa_to_sheet(finalData);

        // --- MERGES ---
        const merges: any[] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: LAST_COL } }, // A1 to Last Col Packing List
            // Exporter Address No Merge
            { s: { r: 2, c: 8 }, e: { r: 6, c: 9 } },  // I3:J7 Fabric
            { s: { r: 2, c: 11 }, e: { r: 2, c: 12 } }, // L3:M3
            { s: { r: 3, c: 11 }, e: { r: 3, c: 12 } }, // L4:M4
            { s: { r: 4, c: 11 }, e: { r: 4, c: 12 } }, // L5:M5
            { s: { r: 5, c: 11 }, e: { r: 5, c: 12 } }, // L6:M6
            { s: { r: 6, c: 11 }, e: { r: 6, c: 12 } }, // L7:M7
            { s: { r: 8, c: 10 }, e: { r: 8, c: 12 } }, // K9:M9 DIMN
            // Store Name Row 10 (Index 9)
            { s: { r: 9, c: 0 }, e: { r: 9, c: LAST_COL } }, // A10:LastCol
        ];

        // Dynamic Merges for Sub-Store Headers
        finalData.forEach((row, idx) => {
            // Avoid duplicating the fixed A10 merge if it's there, but set handles logic usually.
            // Just add merges for any row starting with "STORE NAME :"
            // Note: Row 9 is already added above. 
            if (idx !== 9 && row[0] && String(row[0]).startsWith("STORE NAME :")) {
                merges.push({ s: { r: idx, c: 0 }, e: { r: idx, c: LAST_COL } });
            }
        });

        ws['!merges'] = merges;

        // Col Widths
        const wscols = [];
        wscols[COL_CTN_NO] = { wch: 8 };
        wscols[COL_STYLE] = { wch: 15 };
        wscols[COL_COLOUR] = { wch: 15 };
        for (let c = 3; c < currentSizeCol; c++) wscols[c] = { wch: 4 }; // Sizes D to dynamic
        wscols[COL_TOT_PCS] = { wch: 8 };
        wscols[COL_NT_WT] = { wch: 8 };
        wscols[COL_GR_WT] = { wch: 8 };
        wscols[COL_CTN_DIMN] = { wch: 15 };

        ws['!cols'] = wscols;

        // Sheet Name
        let sheetName = baseName.replace(/[\\/?*[\]]/g, "").slice(0, 30);
        if (!sheetName) sheetName = "Sheet1";
        if (wb.SheetNames.includes(sheetName)) {
            let i = 1; while (wb.SheetNames.includes(`${sheetName} ${i}`)) i++;
            sheetName = `${sheetName} ${i}`;
        }

        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    const fileName = `PACKING_LIST_STRICT_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
};

export const generateCartonSheet = async (cartons: Carton[], season: string) => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    // 1. Group by Store for Store-wise Numbering
    const storeGroups: { [store: string]: Carton[] } = {};
    cartons.forEach(c => {
        const store = c.storeName || "Unknown";
        if (!storeGroups[store]) storeGroups[store] = [];
        storeGroups[store].push(c);
    });

    // 2. Sort Logic
    const sortedStores = Object.keys(storeGroups).sort();

    sortedStores.forEach(store => {
        const storeCartons = storeGroups[store];
        // Sort by Index or CreatedAt to ensure consistent ordering (1, 2, 3...)
        storeCartons.sort((a, b) => (a.index || 0) - (b.index || 0));

        const totalForStore = storeCartons.length;

        storeCartons.forEach((carton, idx) => {
            const wsData: any[][] = [];

            // COLOUR & STYLE LOGIC
            const uniquePrints = Array.from(new Set(carton.rows.map(r => r.print).filter(Boolean)));
            const uniqueStyles = Array.from(new Set(carton.rows.map(r => r.style).filter(Boolean)));

            const colourVal = uniquePrints.length > 1 ? "ALL COLOURS" : (uniquePrints[0] || "");
            const styleVal = uniqueStyles.length > 1 ? "ALL STYLES" : (uniqueStyles[0] || "");

            // HEADER BLOCK
            wsData.push(["CARTON NO", ":", `${idx + 1} OF ${totalForStore}`]);
            wsData.push(["SEASON", ":", season]);
            wsData.push(["STORE NAME", ":", carton.storeName]);
            wsData.push(["COLOUR", ":", colourVal]);
            wsData.push(["STYLE", ":", styleVal]);
            wsData.push(["TOTAL PCS", ":", carton.totalPcs]);
            wsData.push(["NET WEIGHT", ":", carton.netWeight ? `${carton.netWeight} Kg` : ""]);
            wsData.push(["GROSS WEIGHT", ":", carton.grossWeight ? `${carton.grossWeight} Kg` : ""]);
            wsData.push(["CARTON DIMENSION", ":", carton.measurement]);
            wsData.push(["MADE IN INDIA"]);

            // Create Sheet for this Carton
            const ws = XLSX.utils.aoa_to_sheet(wsData);

            // Columns Widths
            ws['!cols'] = [
                { wch: 20 }, // Label
                { wch: 2 },  // Colon
                { wch: 40 }  // Value
            ];

            // Sheet Name Generation: STORE_1_OF_X
            // sanitize: remove chars invalid for sheet names (example: * ? : \ / [ ])
            // Excel limit: 31 chars
            const safeStore = store.replace(/[^a-zA-Z0-9 ]/g, "").trim();
            // We need space for "_1_OF_100" -> approx 10-12 chars.
            // Truncate store to ~18 chars.
            const truncatedStore = safeStore.slice(0, 18);
            let sheetName = `${truncatedStore} ${idx + 1} OF ${totalForStore}`.toUpperCase();

            // Clean up multiple spaces
            sheetName = sheetName.replace(/\s+/g, " ").trim();

            // Fallback if name ends up empty or weird, though unlikely with store name
            if (sheetName.length === 0) sheetName = `CTN_${idx + 1}`;

            // Ensure unique just in case (though store + idx should be unique)
            if (wb.SheetNames.includes(sheetName)) {
                sheetName = `${sheetName}_${idx}`;
            }

            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        });
    });

    const fileName = `Carton_Sheets_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
};
