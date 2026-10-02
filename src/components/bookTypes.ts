import type { Book, Chapter, Character, Job, Segment } from "@/db/schema";
import type { Voice } from "@/lib/tts/provider";
export type BookDetail = {
  book: Book;
  chapters: Chapter[];
  characters: (Character & { requirements: string[] })[];
  jobs: Job[];
  progress: { chapterId: string | null; positionMs: number; completed: boolean } | null;
  voices: Voice[];
  warnings: { characterIds: [string, string]; voiceId: string; message: string; suggestion?: string }[];
};
export type ChapterDetail = { chapter: Chapter; segments: Segment[]; characters: { id: string; name: string; voiceId: string | null }[]; blocks: { type: string; text: string; level?: number }[]; audioUrl: string | null };
