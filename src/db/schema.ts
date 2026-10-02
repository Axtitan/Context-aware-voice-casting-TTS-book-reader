import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Anonymous-session users. A cookie carries the id; uploads stay private to it. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  settings: jsonb("settings").$type<UserSettings>().default({}).notNull(),
});

export type UserSettings = {
  theme?: "light" | "dark" | "system";
  defaultSpeed?: number;
  autoplayNext?: boolean;
  defaultNarratorVoiceId?: string;
  defaultMode?: "single" | "multi";
  audioQuality?: "standard" | "high";
  maxConcurrency?: number;
  engine?: string;
};

export type BookStatus =
  | "uploaded"
  | "extracting"
  | "analyzing"
  | "ready"
  | "generating"
  | "failed"
  | "needs_ocr";

export type BookSourceType = "upload" | "gutenberg" | "standardebooks" | "sample";

export type AnalysisStats = {
  chapters: number;
  characters: number;
  majorCharacters: number;
  scenes: number;
  segments: number;
  dialogueSegments: number;
  wordCount: number;
  storyStartBlock: number;
  frontMatterBlocks: number;
  pov: "first" | "third" | "mixed";
  narratorCharacterId?: string | null;
  narratorConfidence?: number;
  estimatedMinutes: number;
  uniqueVoices?: number;
  sharedVoices?: number;
  extraction?: { pages?: number; scanned?: boolean; ocr?: boolean; ocrConfidence?: number; warnings?: string[] };
};

export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    author: text("author"),
    subtitle: text("subtitle"),
    language: text("language").default("en"),
    publisher: text("publisher"),
    publicationYear: text("publication_year"),
    isbn: text("isbn"),
    coverUrl: text("cover_url"),
    description: text("description"),
    // Source / provenance
    sourceType: text("source_type").$type<BookSourceType>().notNull().default("upload"),
    sourceUrl: text("source_url"),
    sourceId: text("source_id"),
    sourceLicense: text("source_license"),
    originalFilename: text("original_filename"),
    format: text("format"), // pdf | epub | docx | doc | txt
    filePath: text("file_path"),
    blocksPath: text("blocks_path"), // cleaned internal representation (JSON)
    // Pipeline
    status: text("status").$type<BookStatus>().notNull().default("uploaded"),
    error: text("error"),
    narrationMode: text("narration_mode").$type<"single" | "multi">().notNull().default("multi"),
    narratorVoiceId: text("narrator_voice_id"),
    engine: text("engine").default("kokoro"),
    wordCount: integer("word_count").default(0),
    analysis: jsonb("analysis").$type<AnalysisStats>(),
    totalDurationMs: integer("total_duration_ms").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("books_user_idx").on(t.userId)],
);

export type ChapterKind = "chapter" | "prologue" | "epilogue" | "part" | "title" | "section";
export type AudioStatus = "none" | "queued" | "generating" | "ready" | "failed";

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .references(() => books.id, { onDelete: "cascade" })
      .notNull(),
    order: integer("order").notNull(),
    title: text("title").notNull(),
    kind: text("kind").$type<ChapterKind>().notNull().default("chapter"),
    startBlock: integer("start_block").notNull(),
    endBlock: integer("end_block").notNull(),
    wordCount: integer("word_count").default(0),
    pov: text("pov").$type<"first" | "third">().default("third"),
    narratorCharacterId: uuid("narrator_character_id"),
    narratorConfidence: real("narrator_confidence").default(0),
    audioStatus: text("audio_status").$type<AudioStatus>().notNull().default("none"),
    audioPath: text("audio_path"),
    durationMs: integer("duration_ms").default(0),
    audioProgress: real("audio_progress").default(0),
    audioError: text("audio_error"),
  },
  (t) => [index("chapters_book_idx").on(t.bookId)],
);

export type CharacterEvidence = { attribute: string; value: string; quote: string };

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .references(() => books.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    aliases: jsonb("aliases").$type<string[]>().default([]).notNull(),
    gender: text("gender"), // "male" | "female" | null (unknown)
    genderConfidence: real("gender_confidence").default(0),
    age: text("age"), // "child" | "young adult" | "adult" | "older adult" | null
    nationality: text("nationality"),
    accent: text("accent"),
    physicalDescriptions: jsonb("physical_descriptions").$type<string[]>().default([]).notNull(),
    vocalDescriptions: jsonb("vocal_descriptions").$type<string[]>().default([]).notNull(),
    personality: jsonb("personality").$type<string[]>().default([]).notNull(),
    evidence: jsonb("evidence").$type<CharacterEvidence[]>().default([]).notNull(),
    importance: text("importance").$type<"major" | "supporting" | "minor">().notNull().default("minor"),
    mentionCount: integer("mention_count").default(0),
    lineCount: integer("line_count").default(0),
    isNarrator: boolean("is_narrator").default(false).notNull(),
    characterConfidence: real("character_confidence").default(0),
    // Voice casting
    voiceId: text("voice_id"),
    voiceSource: text("voice_source").$type<"ai" | "user">().default("ai"),
    voiceLocked: boolean("voice_locked").default(false).notNull(),
    voiceConfidence: real("voice_confidence").default(0),
    voiceReason: text("voice_reason"),
    aiVoiceId: text("ai_voice_id"),
    voiceShared: boolean("voice_shared").default(false).notNull(),
  },
  (t) => [index("characters_book_idx").on(t.bookId)],
);

export const scenes = pgTable(
  "scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .references(() => chapters.id, { onDelete: "cascade" })
      .notNull(),
    order: integer("order").notNull(),
    startBlock: integer("start_block").notNull(),
    endBlock: integer("end_block").notNull(),
    charactersPresent: jsonb("characters_present").$type<string[]>().default([]).notNull(),
    mood: text("mood"),
  },
  (t) => [index("scenes_chapter_idx").on(t.chapterId)],
);

export type SegmentType = "narration" | "dialogue" | "thought" | "heading";

export const segments = pgTable(
  "segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .references(() => books.id, { onDelete: "cascade" })
      .notNull(),
    chapterId: uuid("chapter_id")
      .references(() => chapters.id, { onDelete: "cascade" })
      .notNull(),
    sceneId: uuid("scene_id"),
    order: integer("order").notNull(),
    blockIndex: integer("block_index").notNull(),
    type: text("type").$type<SegmentType>().notNull(),
    speakerCharacterId: uuid("speaker_character_id"),
    speakerConfidence: real("speaker_confidence").default(0),
    attributionMethod: text("attribution_method"),
    text: text("text").notNull(),
    emotion: text("emotion").default("neutral"),
    intensity: real("intensity").default(0.2),
    pace: text("pace").default("medium"),
    delivery: text("delivery"),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    paragraphEnd: boolean("paragraph_end").default(false).notNull(),
  },
  (t) => [index("segments_chapter_idx").on(t.chapterId, t.order)],
);

export const audioAssets = pgTable(
  "audio_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .references(() => books.id, { onDelete: "cascade" })
      .notNull(),
    chapterId: uuid("chapter_id"),
    segmentId: uuid("segment_id"),
    engine: text("engine").notNull(),
    voiceId: text("voice_id").notNull(),
    voiceVersion: text("voice_version").notNull(),
    textHash: text("text_hash").notNull(),
    path: text("path").notNull(),
    durationMs: integer("duration_ms").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("audio_cache_key").on(t.engine, t.voiceId, t.voiceVersion, t.textHash)],
);

export type JobType = "analyze_book" | "generate_audio";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .references(() => books.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").$type<JobType>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    stage: text("stage").default("Queued"),
    progress: real("progress").default(0).notNull(),
    stats: jsonb("stats").$type<Record<string, number | string | boolean>>().default({}).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("jobs_book_idx").on(t.bookId)],
);

export const playbackProgress = pgTable(
  "playback_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    bookId: uuid("book_id")
      .references(() => books.id, { onDelete: "cascade" })
      .notNull(),
    chapterId: uuid("chapter_id"),
    positionMs: integer("position_ms").default(0).notNull(),
    completed: boolean("completed").default(false).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("progress_user_book").on(t.userId, t.bookId)],
);

export type Book = typeof books.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type Segment = typeof segments.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Scene = typeof scenes.$inferSelect;
