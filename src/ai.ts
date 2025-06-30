#!/usr/bin/env node

// Data一般用于表示从服务器上请求到的数据，Info一般表示解析并筛选过的要传输给大模型的数据。变量使用驼峰命名，常量使用全大写下划线命名。
import { program } from 'commander';
import { startSseAndStreamableHttpMcpServer } from 'mcp-http-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import axios from 'axios';
import { z } from 'zod';
import { format, parse } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import {
  CrewGuardReport,
  checkSite
} from './yu.js';

const MCP_NAME = "mcp-crew-risk"
const VERSION = "0.0.1"



// Configuration schema for Smithery - matches existing Config interface
export const configSchema = z.object({
  server: z.object({
    port: z.number().optional().describe("The port to listen on for SSE or MCP transport"),
    host: z.string().optional().describe("The host to bind the server to. Default is localhost. Use 0.0.0.0 to bind to all interfaces")
  }).optional()
});





// Create server instance
export const server = new McpServer({
  name: MCP_NAME,
  version: VERSION,
  capabilities: {
    resources: {},
    tools: {},
  },
  instructions:
    '该服务主要用于帮助用户对需要爬取数据的网址进行风险评估并总结风险报告：\n\n' +
    '**原则：**\n' +
    '*   **参数准确性**：确保传递给每个的参数格式和类型都正确，特别是日期格式。\n' +
    '*   **必要时追问**：如果用户信息不足以调用接口，请向用户追问缺失的信息。\n' +
    '*   **清晰呈现结果**：将接口返回的信息以用户易于理解的方式进行呈现。\n\n' +
    '请根据上述指引选择接口。',
});

interface QueryResponse {
  [key: string]: any;
  httpstatus?: string;
  data:
    | {
        [key: string]: any;
      }
    | string;
  status: boolean;
}

interface LeftTicketsQueryResponse extends QueryResponse {
  httpstatus: string;
  data: {
    [key: string]: any;
  };
  messages: string;
}


server.tool(
  'get-current-date',
  'Retrieves the current date based on the Shanghai time zone (Asia/Shanghai, UTC+8), and returns it in the format "yyyy-MM-dd". It is primarily used to parse user-mentioned relative dates (e.g., "tomorrow", "next Wednesday") and provide accurate date input for other interfaces that require date information.',
  {},
  async () => {
    try {
      const timeZone = 'Asia/Shanghai';
      const nowInShanghai = toZonedTime(new Date(), timeZone);
      const formattedDate = format(nowInShanghai, 'yyyy-MM-dd');
      return {
        content: [{ type: 'text', text: formattedDate }],
      };
    } catch (error) {
      console.error('Error getting current date:', error);
      return {
        content: [{ type: 'text', text: 'Error: Failed to get current date.' }],
      };
    }
  }
);

server.tool(
  'assess-crew-risk',
  'This system evaluates the compliance and potential risks associated with web crawling activities. It is designed to assist developers, legal teams, and data professionals in ensuring that their crawlers operate within acceptable technical, legal, and ethical boundaries.',
  {
    url: z.string().describe('Web page URL, for example: https://www.xxx.com'),
  },
  async ({ url }) => {
    let result = await checkSite(url)
    console.error('url:', url, result);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }
);


async function init() {}

program
  .name('mcp-crew-risk')
  .description('MCP server for crew risk')
  .version(VERSION)
  .option(
    '--host <host>',
    'host to bind server to. Default is localhost. Use 0.0.0.0 to bind to all interfaces.'
  )
  .option('--port <port>', 'port to listen on for SSE and HTTP transport.')
  .action(async (options) => {
    try {
      await init();
      if (options.port || options.host) {
        await startSseAndStreamableHttpMcpServer({
          host: options.host,
          port: options.port,
          // @ts-ignore
          createMcpServer: async ({ headers }) => {
            return server;
          },
        });
      } else {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('crew risk MCP Server running on stdio');
      }
    } catch (error) {
      console.error('Fatal error in main():', error);
      process.exit(1);
    }
  });

program.parse();

export default function ({ config }: { config: z.infer<typeof configSchema> }) {

  return server.server;
}

