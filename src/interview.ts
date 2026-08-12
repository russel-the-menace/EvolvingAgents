import type { InterviewPacket, Message, Settings } from './types';

const keywords = [
  'Java', 'Kotlin', 'Android', 'iOS', 'Python', 'JavaScript', 'TypeScript', 'Go', 'Golang',
  '.NET', 'C#', 'Node', 'SQL', 'MySQL', 'PostgreSQL', 'Redis', 'Docker', 'Kubernetes',
  '微服务', '分布式', '客服', '客户成功', '运营', '销售', '招聘', 'HR', '远程', '英语',
];

function matchingKeywords(text: string) {
  const lowered = text.toLowerCase();
  return keywords.filter((keyword) => lowered.includes(keyword.toLowerCase())).slice(0, 8);
}

export function preparePacket(jd: string, resume: string): InterviewPacket {
  const jdKeywords = matchingKeywords(jd);
  const resumeKeywords = matchingKeywords(resume);
  const matching = jdKeywords.filter((item) => resumeKeywords.some((resumeItem) => resumeItem.toLowerCase() === item.toLowerCase()));
  const gaps = jdKeywords.filter((item) => !matching.includes(item));
  const focusAreas = [...matching, ...gaps].slice(0, 6);
  const questionTypes = ['自我介绍与岗位匹配', '具体项目或经历深挖', '技术/业务判断', '跨职能协作', '动机与远程协作'];

  return {
    id: crypto.randomUUID(),
    preparedAt: new Date().toISOString(),
    jd,
    resume,
    focusAreas,
    questionTypes,
    brief: matching.length
      ? `本次优先调用与 ${matching.join('、')} 相关的经历。对 ${gaps.join('、') || '岗位要求'}，先说明可迁移能力与具体学习/实践，再给出解决问题的方法。`
      : '尚未识别到明确重合技能。正式问答将以简历中的真实经历为优先证据，并将岗位要求映射为可迁移能力。',
  };
}

function systemPrompt(packet: InterviewPacket) {
  return `你是 MindClone 的正式面试回答引擎。你的输出给候选人阅读后自行作答。

规则：
1. 直接回答问题，先给清晰结论，再给一到两个具体支撑点；不要寒暄，不要说“作为 AI”。
2. 只使用本次简历和已给面试上下文中能支持的经历。若问题超出材料，坦率说明可迁移能力和学习/验证方案，不捏造数字、公司、项目、年限或职责。
3. 面试官追问、质疑或打断时，以本轮已说内容为事实约束，不能自相矛盾。
4. 回答自然口语化，适合候选人朗读；默认中文，问题为英文时用英文回答。控制在 120 到 220 个汉字或相近英文长度，除非面试官明确要求深入。
5. 本次面试准备摘要：${packet.brief}

目标 JD：
${packet.jd}

本次投递简历：
${packet.resume}`;
}

export async function streamCandidateAnswer(
  settings: Settings,
  packet: InterviewPacket,
  messages: Message[],
  onDelta: (delta: string) => void,
  signal: AbortSignal,
) {
  const requestMessages = [
    { role: 'system', content: systemPrompt(packet) },
    ...messages.map((message) => ({
      role: message.role === 'interviewer' ? 'user' : 'assistant',
      content: message.content,
    })),
  ];

  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: settings.model,
      messages: requestMessages,
      temperature: 0.45,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`本地模型未响应（${response.status}）。请检查模型服务和设置。`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (typeof delta === 'string') onDelta(delta);
      } catch {
        // Ignore provider keep-alives and partial event frames.
      }
    }
  }
}
