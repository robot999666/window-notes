import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.string(),
    category: z.enum(['工程实践', 'AI 与研究', '学习记录']),
    tags: z.array(z.string()),
    readingTime: z.string(),
    source: z.string().url(),
    sourceLabel: z.string(),
  }),
});

export const collections = { notes };
