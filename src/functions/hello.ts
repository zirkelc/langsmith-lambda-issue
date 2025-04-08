import type { Handler, LambdaFunctionURLEvent } from 'aws-lambda';
import { AISDKExporter } from 'langsmith/vercel';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { traceable } from 'langsmith/traceable';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Client } from 'langsmith';

// TODO replace with your own keys
process.env.OPENAI_API_KEY = '';
process.env.LANGSMITH_API_KEY = '';

process.env.LANGSMITH_TRACING = 'true';
process.env.LANGSMITH_ENDPOINT = 'https://api.smith.langchain.com';
process.env.LANGSMITH_PROJECT = 'langsmith-issue';

const client = new Client({
  blockOnRootRunFinalization: true,
});

const exporter = new AISDKExporter({ debug: true, client });

export const handler: Handler<LambdaFunctionURLEvent> = async (event) => {
  if (event.rawPath !== '/') {
    return {
      statusCode: 404,
      body: JSON.stringify({ message: 'Not found' }),
    };
  }

  const sdk = new NodeSDK({
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  try {
    const wrappedGenerateText = traceable(
      async (content: string) => {
        const { text } = await generateText({
          model: openai('gpt-4o-mini'),
          messages: [{ role: 'user', content }],
          experimental_telemetry: AISDKExporter.getSettings(),
        });

        const reverseText = traceable(
          async (text: string) => {
            return text.split('').reverse().join('');
          },
          {
            name: 'reverseText',
            client,
          },
        );

        const reversedText = await reverseText(text);
        return { text, reversedText };
      },
      { name: 'parentTraceable', client },
    );

    const result = await wrappedGenerateText(
      'What color is the sky? Respond with one word.',
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ result }),
    };
  } finally {
    await exporter?.forceFlush?.();
    await client.flush();
    await sdk.shutdown();
  }
};
