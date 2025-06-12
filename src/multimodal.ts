import { ClipEmbedding } from '@llamaindex/clip';
import { openai } from '@llamaindex/openai';
import { QdrantVectorStore } from '@llamaindex/qdrant';
import { ImageReader } from '@llamaindex/readers/image';
import dotenv from 'dotenv';
import { extractText, getResponseSynthesizer, Settings, storageContextFromDefaults, VectorStoreIndex } from 'llamaindex';

import path from 'node:path';

dotenv.config();

const { OPENAI_API_KEY, QDRANT_URL } = process.env;

const dataDir = path.resolve(__dirname, '../data');
const storageDir = path.resolve(__dirname, '../storage');
const filesImage = [
  path.join(dataDir, 'image-1.png'),
  path.join(dataDir, 'image-2.png'),
  path.join(dataDir, 'image-3.png'),
];

const llmOpenApi = openai({
  apiKey: OPENAI_API_KEY,
  model: 'gpt-4o',
  maxTokens: 512,
});

Settings.llm = llmOpenApi;
Settings.embedModel = new ClipEmbedding();
Settings.chunkSize = 512;
Settings.chunkOverlap = 20;

Settings.callbackManager.on('retrieve-end', (event) => {
  const { nodes, query } = event.detail;
  const text = extractText(query);
  console.log(`Retrieved ${nodes.length} nodes for query: ${text}`);
});

const imageReader = new ImageReader();

Settings.callbackManager.on('retrieve-end', (event) => {
  const { nodes, query } = event.detail;
  const text = extractText(query);
  console.log(`Retrieved ${nodes.length} nodes for query: ${text}`);
});

async function getStorageContext() {
  //   return await storageContextFromDefaults({
  //   persistDir: storageDir,
  //   vectorStores: {
  //     IMAGE: await SimpleVectorStore.fromPersistDir(
  //       path.join(storageDir, 'images'),
  //       new ClipEmbedding(),
  //     ),
  //   },
  // });
  const vectorStoreImage = new QdrantVectorStore({
    url: QDRANT_URL,
    collectionName: 'image-collection',
    embeddingModel: new ClipEmbedding(),
  });
  return await storageContextFromDefaults({
    persistDir: storageDir,
    vectorStores: {
      IMAGE: vectorStoreImage,
    },
  });
}

async function main() {
  const storageContext = await getStorageContext();
  const documents = [];
  for (const file of filesImage) {
    documents.push(...(await imageReader.loadData(file)));
  }
  const index = await VectorStoreIndex.fromDocuments(documents, {
    storageContext,
  });

  const queryEngine = index.asQueryEngine({
    responseSynthesizer: getResponseSynthesizer('multi_modal'),
    retriever: index.asRetriever({ topK: { TEXT: 3, IMAGE: 1, AUDIO: 0 } }),
  });
  const stream = await queryEngine.query({
    query: 'What\'s the relations between subcomponents inside the portfolio module of Health Panel project?',
    stream: true,
  });
  for await (const chunk of stream) {
    process.stdout.write(chunk.response);
  }
  process.stdout.write('\n');
}

void main().then(() => {
  console.log('Done');
}).catch(console.error);
