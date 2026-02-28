export type StoryChapterMeta = {
    id: number;
    roman: string;
    name: string;
};

export const STORY_CHAPTERS: readonly StoryChapterMeta[] = [
    { id: 1, roman: 'I', name: 'NEON GUTTER' },
    { id: 2, roman: 'II', name: 'CHROME HEAVEN' },
    { id: 3, roman: 'III', name: 'VOID RUNNER' },
    { id: 4, roman: 'IV', name: 'GLITCH PALACE' },
    { id: 5, roman: 'V', name: 'DATA STREAM' },
];

export type StoryFeatureMeta = {
    id: string;
    label: string;
    chapterUnlocked: number;
};

export const STORY_FEATURES: readonly StoryFeatureMeta[] = [
    { id: 'hand_audit', label: 'Hand Audit', chapterUnlocked: 1 },
    { id: 'agent_coach', label: 'Agent Coach', chapterUnlocked: 2 },
    { id: 'agent_ui_programming', label: 'Agent UI Programming', chapterUnlocked: 3 },
    { id: 'invite_friends', label: 'Invite Friends', chapterUnlocked: 4 },
    { id: 'story_complete', label: 'Story Completion', chapterUnlocked: 5 },
];

const CHAPTER_META_BY_ID = new Map(STORY_CHAPTERS.map((chapter) => [chapter.id, chapter] as const));
const FEATURE_META_BY_ID = new Map(STORY_FEATURES.map((feature) => [feature.id, feature] as const));

export function getStoryChapterMeta(chapterId: number): StoryChapterMeta | undefined {
    return CHAPTER_META_BY_ID.get(chapterId);
}

export function getStoryFeatureMeta(featureId: string): StoryFeatureMeta | undefined {
    return FEATURE_META_BY_ID.get(featureId);
}

export function storyChapterTitle(chapterId: number): string {
    const chapter = getStoryChapterMeta(chapterId);
    if (!chapter) {
        return `Chapter ${chapterId}`;
    }
    return `Chapter ${chapter.roman}: ${chapter.name}`;
}

export function storyChapterRoman(chapterId: number): string {
    const chapter = getStoryChapterMeta(chapterId);
    if (!chapter) {
        return `${chapterId}`;
    }
    return chapter.roman;
}
