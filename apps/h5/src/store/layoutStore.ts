import { create } from 'zustand';

export type UiProfile = 'compact' | 'desktop';

type LayoutStoreState = {
    uiProfile: UiProfile;
    setUiProfile: (profile: UiProfile) => void;
};

export const useLayoutStore = create<LayoutStoreState>((set) => ({
    uiProfile: 'compact',
    setUiProfile: (uiProfile) => set({ uiProfile }),
}));

