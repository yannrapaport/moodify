import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSearchTools } from './search.js';
import { registerPlaybackTools } from './playback.js';
import { registerQueueTools } from './queue.js';
import { registerPlayerTools } from './player.js';
import { registerPlaylistTools } from './playlists.js';
import { registerLibraryTools } from './library.js';
import { registerUserTools } from './user.js';
import { registerSurpriseMeTools } from './surprise-me.js';

export function registerAllTools(server: McpServer): void {
  registerSearchTools(server);
  registerPlaybackTools(server);
  registerQueueTools(server);
  registerPlayerTools(server);
  registerPlaylistTools(server);
  registerLibraryTools(server);
  registerUserTools(server);
  registerSurpriseMeTools(server);
}
