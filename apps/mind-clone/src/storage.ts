import type { InterviewPacket, Settings } from './types';

const settingsKey = 'mindclone.settings.v1';
const packetKey = 'mindclone.packet.v1';

export const defaultSettings: Settings = {
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen2.5:7b-instruct-q4_K_M',
};

export function loadSettings(): Settings {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(settingsKey) ?? '{}') };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

export function loadPacket(): InterviewPacket | null {
  try {
    const packet = JSON.parse(localStorage.getItem(packetKey) ?? 'null');
    return packet?.sceneId ? packet : null;
  } catch {
    return null;
  }
}

export function savePacket(packet: InterviewPacket) {
  localStorage.setItem(packetKey, JSON.stringify(packet));
}
