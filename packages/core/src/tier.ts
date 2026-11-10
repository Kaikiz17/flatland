export const TIERS = ['—', 'Sprout', 'Walker', 'Surveyor', 'Cartographer'] as const;
export const tierName = (t: number) => TIERS[Math.min(Math.max(t, 0), 4)];
