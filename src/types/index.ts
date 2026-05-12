export interface User {
    uid: string;
    email: string | null;
    role: 'admin' | 'data-entry';
}

export interface SizeConfig {
    id: string;
    label: string; // "38", "S"
    type: 'numeric' | 'alpha';
    order: number;
}

export interface CartonRow {
    id: string;
    print: string;
    style: string;
    sizes: { [key: string]: number | '' }; // Use empty string for empty input, convert to 0 for sum
    totalPcs: number;
    cartonId?: string | null;
    createdBy?: string;
    createdAt?: any;
    batchId?: string; // Scope data to a specific Excel batch
}

export interface Carton {
    id: string;
    cartonNumber: string; // "1 OF 5"
    index: number; // 1, 2, 3... for sorting/recalc
    totalCartonsInSet: number; // The "5" in "1 OF 5"
    season: string;
    storeName: string;
    buyer: string;
    rows: CartonRow[];
    totalPcs: number;
    netWeight: number | '';
    grossWeight: number | '';
    measurement: string;
    createdAt: any;
    createdBy: string;
    sizes?: { [key: string]: number }; // Admin added sizes
    batchId?: string; // Scope data to a specific Excel batch
}

export interface AppSettings {
    season: string;
    activeBatchId?: string;
}

export const SIZE_COLUMNS = [
    "45", "47", "49", "68", "74", "80", "86", "92", "98", "104",
    "110", "116", "122", "128", "134", "140",
    "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL"
]; // Fallback if DB empty

export const BUYER_OPTIONS = [
    "DUNS",
    "MORE THAN A FLINGS"
];

export const PRINT_OPTIONS = [
    "Beach Pig",
    "Clover - Dandelion Yellow",
    "Clover - Sulphur Spring Green",
    "Clover - Vibrant Orange",
    "Fruits - Beach Glass",
    "Fruits - Blushing Bride",
    "Happy Flower",
    "Jellyfish",
    "Jumbled Radish - Blue",
    "Jumbled Radish",
    "Jumbled Radish - Pink",
    "Multi Radish - Blue",
    "Multi Radish - Pink",
    "Radish - Patina Green",
    "Radish - Lilac Chiffon",
    "Radish - Marina Blue",
    "Radish - Sunshine Pale Yellow"
];

export const STYLE_OPTIONS = [
    "Baggy Pants",
    "Bedding",
    "Bonnet",
    "Double Layer Hat",
    "Dungaree",
    "Kimono Body",
    "Knot Hat",
    "Lap Neck Body",
    "Leggings",
    "Long Sleeve Lap neck Body",
    "Long Sleeve Lap neck Suit",
    "Long Sleeve Skater Dress",
    "Long Sleeve Gather Dress",
    "Long Sleeve Top",
    "Pants",
    "Play Suit",
    "Short Pants",
    "Short Sleeve Skater Dress",
    "Short Sleeve Top",
    "Sleeveless Gather Dress",
    "Summer Suit",
    "Sun Hat",
    "Zip Suit",
    "Hood Suit",
    "TERRY SHORT PANT"
];
