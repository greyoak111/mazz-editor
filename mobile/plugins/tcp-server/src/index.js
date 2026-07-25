// mazz-tcp-server JS 侧封装
// API：start({port}) → {port, addresses[]} · stop() · send({id, data: base64}) · close({id})
// 事件：accept {id, addr} · data {id, data(base64)} · closed {id} · error {message}
import { registerPlugin } from '@capacitor/core';

const TcpServer = registerPlugin('TcpServer');

export default TcpServer;
