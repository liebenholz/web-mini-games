import { Client } from '@colyseus/sdk';
import { serverUrl } from './config.js';

let client: Client | null = null;

/** 게임마다 같은 Colyseus 클라이언트를 쓴다 */
export function sdk(): Client {
  client ??= new Client(serverUrl());
  return client;
}
