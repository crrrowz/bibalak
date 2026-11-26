export const PET_SPECIES = [
  "owl",
  "fox",
  "falcon",
  "lynx",
  "otter",
  "starling",
  "turtle",
  "stag",
  "automaton",
] as const;

export type PetSpecies = (typeof PET_SPECIES)[number];
export type PetVariant = "classic" | "gilded" | "midnight" | "verdant";

export interface PetPalette {
  body: string;
  shade: string;
  accent: string;
  eye: string;
  saddle: string;
}

const SPECIES_CLASSIC: Record<PetSpecies, PetPalette> = {
  owl: { body: "#D6CFC4", shade: "#9E9384", accent: "#F5F0E6", eye: "#D97706", saddle: "#7C3AED" },
  fox: { body: "#D95D24", shade: "#9A3412", accent: "#FDE8D7", eye: "#1E1B24", saddle: "#0F766E" },
  falcon: {
    body: "#64748B",
    shade: "#334155",
    accent: "#E2E8F0",
    eye: "#F59E0B",
    saddle: "#B91C1C",
  },
  lynx: { body: "#C29B6C", shade: "#85623E", accent: "#F3E8D6", eye: "#16A34A", saddle: "#6D28D9" },
  otter: {
    body: "#7C5840",
    shade: "#4E3424",
    accent: "#D7B89C",
    eye: "#1E1B24",
    saddle: "#0284C7",
  },
  starling: {
    body: "#273043",
    shade: "#151B28",
    accent: "#7DD3FC",
    eye: "#FBBF24",
    saddle: "#B45309",
  },
  turtle: {
    body: "#4D7C5B",
    shade: "#2D5238",
    accent: "#A3C49A",
    eye: "#1E1B24",
    saddle: "#C2410C",
  },
  stag: { body: "#9C6644", shade: "#6F4529", accent: "#E6CCB2", eye: "#1E1B24", saddle: "#7C2D12" },
  automaton: {
    body: "#B4833E",
    shade: "#785321",
    accent: "#FDE68A",
    eye: "#38BDF8",
    saddle: "#4338CA",
  },
};

export const VARIANT_TINTS: Record<PetVariant, Partial<PetPalette> | null> = {
  classic: null,
  gilded: {
    body: "#D99B26",
    shade: "#925E12",
    accent: "#FEF08A",
    eye: "#1E1B24",
    saddle: "#7C2D12",
  },
  midnight: {
    body: "#3730A3",
    shade: "#1E1B4B",
    accent: "#A5B4FC",
    eye: "#38BDF8",
    saddle: "#C026D3",
  },
  verdant: {
    body: "#16A34A",
    shade: "#14532D",
    accent: "#BBF7D0",
    eye: "#FBBF24",
    saddle: "#9A3412",
  },
};

export function parsePetItemKey(itemKey: string): { species: PetSpecies; variant: PetVariant } {
  const [rawSpecies, rawVariant] = itemKey.split(":");
  const species = PET_SPECIES.includes(rawSpecies as PetSpecies)
    ? (rawSpecies as PetSpecies)
    : "owl";
  const variant =
    rawVariant && rawVariant in VARIANT_TINTS ? (rawVariant as PetVariant) : "classic";
  return { species, variant };
}

export function resolvePetPalette(species: PetSpecies, variant: PetVariant): PetPalette {
  const base = SPECIES_CLASSIC[species];
  const tint = VARIANT_TINTS[variant];
  if (!tint) return base;
  return { ...base, ...tint };
}

export type PixelRect = readonly [
  x: number,
  y: number,
  w: number,
  h: number,
  role: keyof PetPalette,
];

/** 16×16 pixel silhouettes for each of the 9 companion species. */
export const COMPANION_PIXELS: Record<PetSpecies, readonly PixelRect[]> = {
  owl: [
    [5, 4, 1, 1, "shade"],
    [10, 4, 1, 1, "shade"],
    [5, 5, 6, 3, "body"],
    [6, 6, 1, 1, "eye"],
    [9, 6, 1, 1, "eye"],
    [7, 7, 2, 1, "accent"],
    [4, 8, 8, 4, "body"],
    [6, 9, 4, 3, "accent"],
    [4, 9, 1, 3, "shade"],
    [11, 9, 1, 3, "shade"],
    [6, 12, 1, 1, "eye"],
    [9, 12, 1, 1, "eye"],
  ],
  fox: [
    [4, 4, 2, 2, "shade"],
    [9, 4, 2, 2, "shade"],
    [4, 6, 7, 3, "body"],
    [5, 7, 1, 1, "eye"],
    [9, 7, 1, 1, "eye"],
    [6, 8, 3, 1, "accent"],
    [5, 9, 5, 4, "body"],
    [6, 10, 3, 2, "accent"],
    [10, 10, 3, 2, "body"],
    [12, 9, 2, 2, "accent"],
    [5, 13, 1, 1, "shade"],
    [9, 13, 1, 1, "shade"],
  ],
  falcon: [
    [6, 3, 4, 2, "shade"],
    [6, 5, 4, 2, "body"],
    [7, 5, 1, 1, "eye"],
    [5, 6, 1, 1, "accent"],
    [5, 7, 6, 4, "body"],
    [6, 8, 4, 3, "accent"],
    [11, 9, 2, 3, "shade"],
    [7, 11, 1, 2, "eye"],
    [9, 11, 1, 2, "eye"],
  ],
  lynx: [
    [4, 3, 1, 2, "shade"],
    [10, 3, 1, 2, "shade"],
    [4, 5, 7, 3, "body"],
    [5, 6, 1, 1, "eye"],
    [9, 6, 1, 1, "eye"],
    [6, 7, 3, 1, "accent"],
    [5, 8, 6, 4, "body"],
    [4, 9, 1, 3, "shade"],
    [6, 9, 4, 2, "accent"],
    [5, 12, 2, 2, "shade"],
    [9, 12, 2, 2, "shade"],
  ],
  otter: [
    [5, 4, 6, 3, "body"],
    [6, 5, 1, 1, "eye"],
    [9, 5, 1, 1, "eye"],
    [6, 6, 4, 1, "accent"],
    [5, 7, 6, 5, "body"],
    [6, 8, 4, 3, "accent"],
    [11, 10, 3, 2, "shade"],
    [5, 12, 2, 1, "shade"],
    [9, 12, 2, 1, "shade"],
  ],
  starling: [
    [6, 4, 4, 3, "body"],
    [7, 5, 1, 1, "eye"],
    [5, 5, 1, 1, "accent"],
    [6, 7, 5, 4, "body"],
    [7, 8, 3, 2, "accent"],
    [11, 8, 2, 2, "shade"],
    [7, 11, 1, 2, "eye"],
    [9, 11, 1, 2, "eye"],
  ],
  turtle: [
    [5, 6, 6, 4, "shade"],
    [6, 7, 4, 2, "accent"],
    [3, 8, 2, 2, "body"],
    [3, 8, 1, 1, "eye"],
    [4, 10, 8, 2, "body"],
    [4, 12, 2, 1, "shade"],
    [10, 12, 2, 1, "shade"],
  ],
  stag: [
    [4, 2, 1, 2, "accent"],
    [6, 2, 1, 2, "accent"],
    [9, 2, 1, 2, "accent"],
    [11, 2, 1, 2, "accent"],
    [5, 4, 6, 3, "body"],
    [6, 5, 1, 1, "eye"],
    [9, 5, 1, 1, "eye"],
    [5, 7, 6, 4, "body"],
    [6, 8, 4, 2, "accent"],
    [5, 11, 1, 3, "shade"],
    [10, 11, 1, 3, "shade"],
  ],
  automaton: [
    [7, 2, 2, 1, "accent"],
    [5, 4, 6, 4, "body"],
    [6, 5, 1, 1, "eye"],
    [9, 5, 1, 1, "eye"],
    [4, 8, 8, 4, "shade"],
    [6, 9, 4, 2, "accent"],
    [7, 10, 2, 1, "eye"],
    [5, 12, 2, 2, "body"],
    [9, 12, 2, 2, "body"],
  ],
};

/** 16×16 pixel silhouettes for mounted variants (grounded steed pose + saddle). */
export const MOUNT_PIXELS: Record<PetSpecies, readonly PixelRect[]> = {
  owl: [
    [3, 6, 10, 5, "body"],
    [4, 7, 2, 1, "eye"],
    [5, 5, 3, 1, "shade"],
    [6, 6, 5, 2, "saddle"],
    [2, 9, 2, 3, "shade"],
    [12, 9, 2, 3, "shade"],
    [5, 11, 2, 3, "accent"],
    [9, 11, 2, 3, "accent"],
  ],
  fox: [
    [2, 6, 4, 3, "body"],
    [2, 4, 1, 2, "shade"],
    [4, 4, 1, 2, "shade"],
    [3, 7, 1, 1, "eye"],
    [5, 8, 7, 3, "body"],
    [6, 7, 4, 2, "saddle"],
    [12, 7, 3, 2, "accent"],
    [5, 11, 2, 3, "shade"],
    [10, 11, 2, 3, "shade"],
  ],
  falcon: [
    [2, 5, 4, 3, "body"],
    [3, 6, 1, 1, "eye"],
    [1, 6, 1, 1, "accent"],
    [5, 7, 8, 4, "body"],
    [6, 6, 4, 2, "saddle"],
    [13, 8, 2, 3, "shade"],
    [6, 11, 2, 3, "eye"],
    [10, 11, 2, 3, "eye"],
  ],
  lynx: [
    [2, 5, 4, 3, "body"],
    [2, 3, 1, 2, "shade"],
    [5, 3, 1, 2, "shade"],
    [3, 6, 1, 1, "eye"],
    [5, 7, 8, 4, "body"],
    [6, 6, 5, 2, "saddle"],
    [13, 8, 2, 2, "shade"],
    [5, 11, 2, 3, "shade"],
    [11, 11, 2, 3, "shade"],
  ],
  otter: [
    [2, 6, 4, 3, "body"],
    [3, 7, 1, 1, "eye"],
    [5, 8, 8, 3, "body"],
    [6, 7, 5, 2, "saddle"],
    [13, 9, 2, 2, "shade"],
    [5, 11, 2, 2, "shade"],
    [11, 11, 2, 2, "shade"],
  ],
  starling: [
    [2, 5, 4, 3, "body"],
    [3, 6, 1, 1, "eye"],
    [5, 7, 8, 4, "body"],
    [6, 6, 4, 2, "saddle"],
    [13, 8, 2, 2, "accent"],
    [6, 11, 2, 3, "eye"],
    [10, 11, 2, 3, "eye"],
  ],
  turtle: [
    [3, 6, 10, 5, "shade"],
    [5, 5, 6, 2, "saddle"],
    [1, 8, 2, 3, "body"],
    [2, 9, 1, 1, "eye"],
    [4, 11, 8, 2, "body"],
    [4, 13, 2, 1, "shade"],
    [10, 13, 2, 1, "shade"],
  ],
  stag: [
    [2, 2, 1, 2, "accent"],
    [4, 2, 1, 2, "accent"],
    [2, 4, 4, 3, "body"],
    [3, 5, 1, 1, "eye"],
    [5, 7, 8, 4, "body"],
    [6, 6, 5, 2, "saddle"],
    [5, 11, 2, 3, "shade"],
    [11, 11, 2, 3, "shade"],
  ],
  automaton: [
    [3, 4, 3, 3, "body"],
    [4, 5, 1, 1, "eye"],
    [5, 7, 8, 4, "shade"],
    [6, 6, 5, 2, "saddle"],
    [8, 9, 2, 1, "eye"],
    [5, 11, 2, 3, "body"],
    [11, 11, 2, 3, "body"],
  ],
};
