import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * AI Note Cleanup Service
 *
 * Processes raw coach notes and produces cleaned versions:
 * - Fixes grammar and spelling
 * - Adds professional tone
 * - Keeps meaning intact
 *
 * For now, uses a simple rule-based cleanup.
 * Can be swapped for OpenAI / Claude API call later.
 */

/**
 * Process all unprocessed notes (where cleanedContent is null).
 * Called by cronService every hour.
 */
export async function processUncleanedNotes() {
  const uncleaned = await prisma.coachNote.findMany({
    where: { cleanedContent: null },
    orderBy: { createdAt: 'asc' },
    take: 50, // Process in batches
  });

  if (uncleaned.length === 0) {
    return { processed: 0 };
  }

  console.log(`[NoteCleanup] Processing ${uncleaned.length} notes...`);

  let processed = 0;

  for (const note of uncleaned) {
    try {
      const cleaned = cleanNote(note.rawContent);
      await prisma.coachNote.update({
        where: { id: note.id },
        data: { cleanedContent: cleaned },
      });
      processed++;
    } catch (err) {
      console.error(`[NoteCleanup] Failed to process note ${note.id}:`, err);
    }
  }

  console.log(`[NoteCleanup] Done. Processed ${processed}/${uncleaned.length} notes.`);
  return { processed, total: uncleaned.length };
}

/**
 * Rule-based note cleanup. Applies common fixes.
 * This is the "v1" â replace with AI API call when ready.
 */
function cleanNote(raw: string): string {
  let text = raw.trim();

  // 1. Capitalize first letter of each sentence
  text = text.replace(/(^|[.!?]\s+)([a-z])/g, (_, prefix, letter) =>
    prefix + letter.toUpperCase()
  );

  // 2. Capitalize first letter overall
  if (text.length > 0 && text[0] === text[0].toLowerCase()) {
    text = text[0].toUpperCase() + text.slice(1);
  }

  // 3. Common abbreviation expansions for baseball context
  const abbreviations: Record<string, string> = {
    'fb': 'fastball',
    'cb': 'curveball',
    'sl': 'slider',
    'ch': 'changeup',
    'ct': 'cutter',
    'mph': 'MPH',
    'k': 'strikeout',
    'bb': 'walk',
    'reps': 'repetitions',
    'w/': 'with',
    'w/o': 'without',
    'b/c': 'because',
    'thru': 'through',
    'pls': 'please',
    'r&r': 'rest and recovery',
    'rom': 'range of motion',
    'ROM': 'range of motion',
  };

  // Only expand abbreviations that appear as standalone words
  for (const [abbr, full] of Object.entries(abbreviations)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
    text = text.replace(regex, (match) => {
      // Preserve original capitalization pattern for the first letter
      if (match[0] === match[0].toUpperCase() && full[0] === full[0].toLowerCase()) {
        return full[0].toUpperCase() + full.slice(1);
      }
      return full;
    });
  }

  // 4. Ensure proper spacing after punctuation
  text = text.replace(/([.!?,;:])([A-Za-z])/g, '$1 $2');

  // 5. Remove excessive whitespace
  text = text.replace(/\s{2,}/g, ' ');

  // 6. Ensure the note ends with a period if it doesn't end with punctuation
  if (text.length > 0 && !/[.!?]$/.test(text)) {
    text += '.';
  }

  return text;
}

/**
 * Placeholder for future AI-powered cleanup.
 * Swap this in when API keys are configured.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function cleanNoteWithAI(raw: string): Promise<string> {
  // TODO: Implement with OpenAI or Claude API
  // const response = await fetch('https://api.openai.com/v1/chat/completions', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     model: 'gpt-4o-mini',
  //     messages: [
  //       {
  //         role: 'system',
  //         content: 'You are a professional editor for a baseball training facility. Clean up these coach session notes: fix grammar, spelling, and add professional tone. Keep the meaning exactly the same. Keep it concise. Do not add new information.',
  //       },
  //       { role: 'user', content: raw },
  //     ],
  //     max_tokens: 500,
  //   }),
  // });
  // const data = await response.json();
  // return data.choices[0].message.content;
  return cleanNote(raw); // Fallback to rule-based
}
