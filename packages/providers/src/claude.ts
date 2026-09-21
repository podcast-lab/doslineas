import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import type { HighlightPick, HighlightPicker, HighlightRequest } from "@doslineas/core";
import { formatUtterances } from "@doslineas/core";

export const HIGHLIGHT_MODEL = "claude-opus-5";

export const MomentsSchema = z.object({
  moments: z.array(
    z.object({
      startUtterance: z.number().int(),
      endUtterance: z.number().int(),
      title: z.string(),
      reason: z.string()
    })
  )
});

export interface ClaudePickerOptions {
  readonly model?: string;
  readonly apiKey?: string;
  readonly maxTokens?: number;
}

export const SYSTEM_PROMPT = [
  "Eres el editor de vídeo de un pódcast y eliges qué fragmentos de una conversación merecen convertirse en clips verticales para redes.",
  "Recibes la transcripción numerada por intervenciones, con marca de tiempo y hablante.",
  "Eliges fragmentos que se entienden solos: empiezan al principio de una idea y terminan cuando esa idea se cierra.",
  "Prefieres momentos con una afirmación fuerte, una historia concreta, un dato que sorprenda o una pregunta con su respuesta.",
  "Evitas presentaciones, despedidas, cháchara logística y cualquier fragmento que necesite contexto anterior para tener sentido.",
  "Devuelves siempre los índices de intervención tal y como aparecen entre corchetes: nunca inventas tiempos ni índices que no existan."
].join(" ");

export function userPrompt(request: HighlightRequest): string {
  return [
    `Sesión: ${request.session} (idioma ${request.language}).`,
    `Elige ${request.count} momentos. Cada uno debe durar entre ${request.minSeconds} y ${request.maxSeconds} segundos, con ${request.targetSeconds} como duración ideal.`,
    "Los momentos no pueden solaparse entre sí.",
    "Para cada uno da el índice de la primera y la última intervención, un título corto en el idioma de la conversación y una frase explicando por qué funciona como clip.",
    "",
    "Transcripción:",
    formatUtterances(request.utterances)
  ].join("\n");
}

export function claudeHighlightPicker(options: ClaudePickerOptions = {}): HighlightPicker {
  const model = options.model ?? HIGHLIGHT_MODEL;
  const client = options.apiKey === undefined ? new Anthropic() : new Anthropic({ apiKey: options.apiKey });

  return {
    name: `anthropic:${model}`,
    async pick(request: HighlightRequest): Promise<readonly HighlightPick[]> {
      const response = await client.messages.parse({
        model,
        max_tokens: options.maxTokens ?? 16000,
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt(request) }],
        output_config: { format: zodOutputFormat(MomentsSchema) }
      });

      const parsed = response.parsed_output;
      if (parsed === null || parsed === undefined) {
        throw new Error(`${model} answered without a usable list of moments`);
      }

      return parsed.moments;
    }
  };
}
