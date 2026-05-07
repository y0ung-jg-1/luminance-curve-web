export const windowSequence = [1, 2, 3, 5, 10, 15, 20, 25, 50, 75, 100] as const;

export const windowSequenceLabel = windowSequence.map((level) => `${level}%`).join(' -> ');
