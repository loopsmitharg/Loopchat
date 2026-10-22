import type { ADDRESS, EMOJI_LEVELS, FORMALITY, LENGTHS } from "@/lib/ai-profile";
import type { ATTITUDES, INITIATIVE, SALES_INTENSITY, STYLES } from "@/lib/bot-config";

export type FormalityValue = (typeof FORMALITY)[number];
export type AddressValue = (typeof ADDRESS)[number];
export type EmojiValue = (typeof EMOJI_LEVELS)[number];
export type LengthValue = (typeof LENGTHS)[number];
export type AttitudeValue = (typeof ATTITUDES)[number];
export type InitiativeValue = (typeof INITIATIVE)[number];
export type SalesIntensityValue = (typeof SALES_INTENSITY)[number];
export type StyleValue = (typeof STYLES)[number];
