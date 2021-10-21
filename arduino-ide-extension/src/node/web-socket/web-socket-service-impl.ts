import { injectable } from 'inversify';
import * as WebSocket from 'ws';
import { WebSocketService } from './web-socket-service';

@injectable()
export default class WebSocketServiceImpl implements WebSocketService {
  protected wsClients: WebSocket[];
  protected server: WebSocket.Server;

  constructor() {
    this.server = new WebSocket.Server({ port: 0 });
    this.server.on('connection', this.addClient.bind(this));
    this.wsClients = [];
  }

  private addClient(ws: WebSocket): void {
    this.wsClients.push(ws);
    ws.onclose = () => {
      this.wsClients.splice(this.wsClients.indexOf(ws), 1);
    };
  }

  getAddress(): WebSocket.AddressInfo {
    return this.server.address() as WebSocket.AddressInfo;
  }

  sendMessage(message: string): void {
    this.wsClients.forEach((w) => {
      try {
        w.send(message);
      } catch {
        w.close();
      }
    });
  }
}
