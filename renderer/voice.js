// renderer/voice.js —— 语音输入（Web Speech API；Electron 无语音服务时优雅降级说明）
import { toast } from './shell/shell.js';

let activeRec = null;

export function registerVoiceCommands(commands) {
  commands.register('voice.dictate', {
    title: '语音输入（开始/停止）', icon: '🎙', group: '工具',
    when: "module=='markdown' || module=='text' || module=='notes'",
    run: () => {
      // 再次执行 = 停止
      if (activeRec) {
        activeRec.stop();
        return;
      }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        toast('当前环境不支持语音识别（Electron 默认不带语音服务）');
        return;
      }
      const rec = new SR();
      rec.lang = 'zh-CN';
      rec.continuous = true;
      rec.interimResults = true;
      let finalText = '';
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            finalText += e.results[i][0].transcript;
            document.execCommand('insertText', false, e.results[i][0].transcript);
          }
        }
      };
      rec.onerror = (e) => {
        activeRec = null;
        const reason = {
          'not-allowed': '麦克风权限被拒绝',
          'no-speech': '没有听到声音',
          'audio-capture': '找不到麦克风',
          'network': '语音服务不可达（Electron 的语音识别依赖在线服务，当前网络无法使用）',
        }[e.error] || e.error;
        toast('语音识别结束：' + reason);
      };
      rec.onend = () => {
        if (activeRec === rec) activeRec = null;
        if (finalText) toast('语音输入完成');
      };
      try {
        rec.start();
        activeRec = rec;
        toast('🎙 语音输入中…（再按一次 Ctrl+Shift+V 或执行「语音输入」停止）', 4000);
      } catch (e) {
        toast('无法启动语音识别：' + (e.message || e));
      }
    },
  });
}
