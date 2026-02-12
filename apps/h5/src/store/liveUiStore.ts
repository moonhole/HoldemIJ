import { create } from 'zustand';

type LiveUiState = {
    selectedPlayerChair: number;
    openPlayerCard: (chair: number) => void;
    closePlayerCard: () => void;
    clearLiveUi: () => void;
};

export const useLiveUiStore = create<LiveUiState>((set) => ({
    selectedPlayerChair: -1,

    openPlayerCard: (chair) =>
        set((state) => ({
            ...state,
            selectedPlayerChair: chair,
        })),

    closePlayerCard: () =>
        set((state) => ({
            ...state,
            selectedPlayerChair: -1,
        })),

    clearLiveUi: () =>
        set((state) => ({
            ...state,
            selectedPlayerChair: -1,
        })),
}));
