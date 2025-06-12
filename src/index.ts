import { ClipEmbedding } from '@llamaindex/clip';
import { HuggingFaceEmbedding } from '@llamaindex/huggingface';
import { openai } from '@llamaindex/openai';
import { QdrantVectorStore } from '@llamaindex/qdrant';
import { ImageReader } from '@llamaindex/readers/image';
import { PDFReader } from '@llamaindex/readers/pdf';
import { agent, agentStreamEvent } from '@llamaindex/workflow';
import dotenv from 'dotenv';
import type { BaseReader, BaseVectorStore, Document, Metadata } from 'llamaindex';
import { ModalityType, Settings, tool, VectorStoreIndex } from 'llamaindex';

import path from 'node:path';

dotenv.config();

const { OPENAI_API_KEY, QDRANT_URL } = process.env;

const llmOpenApi = openai({
  apiKey: OPENAI_API_KEY,
  model: 'gpt-4o',
});

const embeddingModel = new HuggingFaceEmbedding({
  modelType: 'sentence-transformers/all-MiniLM-L6-v2',
});

Settings.llm = llmOpenApi;
Settings.embedModel = embeddingModel;

const pdfReader = new PDFReader();
const imageReader = new ImageReader();
const vectorStoreText = new QdrantVectorStore({
  url: QDRANT_URL,
  collectionName: 'text-collection',
  embeddingModel,
});
const vectorStoreImage = new QdrantVectorStore({
  url: QDRANT_URL,
  collectionName: 'image-collection',
  embeddingModel: new ClipEmbedding(),
});

async function getDocuments(filesText: string[], reader: BaseReader, vectorStore: BaseVectorStore, modalityType: ModalityType) {
  console.log('Loading documents from:', filesText);
  let documents: Document<Metadata>[] = [];
  for (const file of filesText) {
    documents = documents.concat(await reader.loadData(file));
  }
  console.log(`Loaded ${documents.length} documents.`);

  console.log('Creating vector store index for ' + documents.length + ' documents...');
  const index = await VectorStoreIndex.fromDocuments(documents, {
    vectorStores: {
      [modalityType]: vectorStore,
    },
  });
  return index;
}

async function main() {
  const dataDir = path.resolve(__dirname, '../data');
  const filesText = [path.join(dataDir, 'CSF_Proposed_Budget_Book_June_2024_r8.pdf')];
  const filesImage = [
    path.join(dataDir, 'image-1.png'),
    path.join(dataDir, 'image-2.png'),
    path.join(dataDir, 'image-3.png'),
  ];

  const docText = await getDocuments(filesText, pdfReader, vectorStoreText, ModalityType.TEXT);
  const docImage = await getDocuments(filesImage, imageReader, vectorStoreImage, ModalityType.IMAGE);

  const tools = [
    docText.queryTool({
      metadata: {
        name: 'san_francisco_budget_tool',
        description: `This tool can answer detailed questions about the individual components of the budget of San Francisco in 2024-2025 & 2025-2026.`,
      },
      options: { similarityTopK: 10 },
    }),
    docImage.queryTool({
      metadata: {
        name: 'health_panel_portfolio_tool',
        description: `This tool can answer detailed questions the architecture of portfolio module inside the Health Panel project.`,
      },
      options: { similarityTopK: 10 },
    }),
    tool(({ a, b }) => {
      return String (a + b);
    }, {
      name: 'sumNumbers',
      description: 'Use this function to sum two numbers',
      parameters: {
        type: 'object',
        properties: {
          a: {
            type: 'number',
            description: 'First number to sum',
          },
          b: {
            type: 'number',
            description: 'Second number to sum',
          },
        },
        required: ['a', 'b'],
      },
    }),
  ];

  console.log('Creating RAG agent with tools...');
  const ragAgent = agent({
    tools,
    llm: llmOpenApi,
  });

  console.log('Running RAG agent...');
  async function runStream(prompt: string) {
    const events = ragAgent.runStream(prompt);
    for await (const event of events) {
      if (agentStreamEvent.include(event)) {
        process.stdout.write(event.data.delta);
      }
    }
    console.log('\n');
  }

  await runStream('What\'s the combined budget of San Francisco for community health and public protection in 2024-25?');

  await runStream('What\'s the relations between subcomponents inside the portfolio module of Health Panel project?');
}

void main().then(() => {
  console.log('Done');
}).catch(console.error);
