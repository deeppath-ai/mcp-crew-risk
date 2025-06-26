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
  '获取当前日期，以上海时区（Asia/Shanghai, UTC+8）为准，返回格式为 "yyyy-MM-dd"。主要用于解析用户提到的相对日期（如“明天”、“下周三”），为其他需要日期的接口提供准确的日期输入。',
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
  '爬虫合规风险评估体系评估',
  {
    url: z.string().describe('网页url，例如："https://www.xxx.com"'),
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
        console.error('crew risk MCP Server running on stdio @Joooook');
      }
    } catch (error) {
      console.error('Fatal error in main():', error);
      process.exit(1);
    }
  });

program.parse();
