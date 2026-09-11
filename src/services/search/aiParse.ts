import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

// Ported from the BFFs' routes/search.ts POST /parse handler (the Sonthillu
// fork's version, which additionally sets defaultHeaders and isolates the
// OpenAI call's own error handling — picked over the Radha fork's plainer
// version per the "more complete of the two" direction).

const ParsedSearchQuerySchema = z.object({
  location: z
    .string()
    .nullable()
    .describe('The city, locality, or state mentioned. e.g. Gachibowli, Hyderabad'),
  propertyType: z
    .enum([
      'APARTMENT',
      'VILLA',
      'INDEPENDENT_HOUSE',
      'PLOT',
      'COMMERCIAL',
      'OFFICE',
      'RETAIL',
      'WAREHOUSE',
    ])
    .nullable()
    .describe('The type of property if mentioned.'),
  bedrooms: z
    .string()
    .nullable()
    .describe(
      'The BHK format, e.g. "2" or "3" or "4" for 2BHK/3BHK/4BHK. For commercial, skip this.',
    ),
  minBudget: z.number().nullable().describe('Minimum budget in INR if specified.'),
  maxBudget: z
    .number()
    .nullable()
    .describe('Maximum budget in INR if specified. e.g., 2 crores = 20000000.'),
  possessionStatus: z
    .enum(['READY_TO_MOVE', 'UNDER_CONSTRUCTION'])
    .nullable()
    .describe('Possession status if mentioned.'),
});
export type ParsedSearchQuery = z.infer<typeof ParsedSearchQuerySchema>;

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      apiKey: process.env.OPENAI_API_KEY,
      defaultHeaders: {
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
        'X-Title': 'RRH CRM Public Search',
      },
    });
  }
  return client;
}

export async function parseNaturalLanguageQuery(query: string): Promise<ParsedSearchQuery> {
  if (!process.env.OPENAI_API_KEY) {
    throw {
      status: 503,
      message: 'AI search is currently disabled (OPENAI_API_KEY not configured).',
    };
  }

  let parsed: ParsedSearchQuery | undefined;
  try {
    const completion = await getClient().chat.completions.parse({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            "You are an intelligent real estate search parser. Extract structured search criteria from the user's natural language query.",
        },
        { role: 'user', content: query },
      ],
      response_format: zodResponseFormat(ParsedSearchQuerySchema, 'search_criteria'),
    });
    parsed = completion.choices[0]?.message?.parsed ?? undefined;
  } catch (apiError: any) {
    throw { status: 502, message: apiError?.message || 'AI search provider error' };
  }

  if (!parsed) throw { status: 500, message: 'Failed to parse query' };
  return parsed;
}
