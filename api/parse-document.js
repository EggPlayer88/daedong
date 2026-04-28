import { createClient } from '@supabase/supabase-js';

// Supabase 서비스 클라이언트 (서버사이드 전용)
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── HWPX 파서 (ZIP + XML) ───
async function parseHWPX(buffer) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);

  const texts = [];

  // section*.xml 파일들에서 텍스트 추출
  const sectionFiles = Object.keys(zip.files)
    .filter(name => /Contents\/section\d+\.xml$/i.test(name))
    .sort();

  for (const fileName of sectionFiles) {
    const xml = await zip.files[fileName].async('string');
    // <hp:t> 또는 <t> 태그에서 텍스트 추출
    const matches = xml.match(/<(?:hp:)?t[^>]*>([^<]*)<\/(?:hp:)?t>/g);
    if (matches) {
      const lineTexts = matches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
      texts.push(lineTexts.join(''));
    }
  }

  // section 파일이 없으면 모든 XML에서 시도
  if (texts.length === 0) {
    for (const [name, file] of Object.entries(zip.files)) {
      if (name.endsWith('.xml') && !file.dir) {
        const xml = await file.async('string');
        const matches = xml.match(/<(?:hp:)?t[^>]*>([^<]*)<\/(?:hp:)?t>/g);
        if (matches) {
          texts.push(matches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(''));
        }
      }
    }
  }

  return texts.join('\n').trim();
}

// ─── HWP 파서 (CFB 바이너리) ───
async function parseHWP(buffer) {
  try {
    // cfb 패키지로 Compound File Binary 읽기
    const CFB = await import('cfb');
    const cfb = CFB.read(buffer, { type: 'buffer' });

    const texts = [];

    // HWP는 "BodyText/Section0", "BodyText/Section1" 등에 텍스트 저장
    for (const entry of cfb.FileIndex) {
      if (entry.name && /^Section\d+$/i.test(entry.name)) {
        const data = CFB.find(cfb, entry.name);
        if (data && data.content) {
          // HWP 섹션 바이너리에서 텍스트 추출 시도
          const text = extractTextFromHWPSection(data.content);
          if (text) texts.push(text);
        }
      }
    }

    // BodyText 경로로도 시도
    if (texts.length === 0) {
      for (let i = 0; i < 100; i++) {
        const path = `/BodyText/Section${i}`;
        const entry = CFB.find(cfb, path);
        if (!entry) break;
        if (entry.content) {
          const text = extractTextFromHWPSection(entry.content);
          if (text) texts.push(text);
        }
      }
    }

    const result = texts.join('\n').trim();
    if (result) return result;

    // 최후 수단: 바이너리에서 한글/영문 텍스트 직접 추출
    return extractKoreanText(buffer);
  } catch (e) {
    console.error('HWP CFB parse error:', e.message);
    // 폴백: 바이너리에서 텍스트 직접 추출
    return extractKoreanText(buffer);
  }
}

// HWP 섹션 바이너리에서 텍스트 추출
function extractTextFromHWPSection(content) {
  const buf = Buffer.from(content);
  const texts = [];
  let current = '';

  // HWP 텍스트는 UTF-16LE로 인코딩됨
  for (let i = 0; i < buf.length - 1; i += 2) {
    const code = buf.readUInt16LE(i);

    // 일반 텍스트 범위 (한글, 영문, 숫자, 기본 구두점)
    if (
      (code >= 0x20 && code <= 0x7E) ||   // ASCII printable
      (code >= 0xAC00 && code <= 0xD7AF) || // 한글 음절
      (code >= 0x3131 && code <= 0x318E) || // 한글 자모
      (code >= 0x2000 && code <= 0x206F) || // 일반 구두점
      (code >= 0x3000 && code <= 0x303F) || // CJK 구두점
      (code >= 0xFF01 && code <= 0xFF5E)    // 전각 문자
    ) {
      current += String.fromCharCode(code);
    } else if (code === 0x0A || code === 0x0D) {
      // 줄바꿈
      if (current.trim()) {
        texts.push(current.trim());
        current = '';
      }
    } else if (code < 0x20 && current.length > 0) {
      // 제어 문자 → 단어 구분
      if (current.trim().length > 1) {
        texts.push(current.trim());
      }
      current = '';
    }
  }

  if (current.trim()) texts.push(current.trim());

  // 너무 짧은 조각 필터링
  return texts.filter(t => t.length > 1).join('\n');
}

// 바이너리에서 한글 텍스트 직접 추출 (최후 수단)
function extractKoreanText(buffer) {
  const buf = Buffer.from(buffer);
  const texts = [];
  let current = '';

  for (let i = 0; i < buf.length - 1; i += 2) {
    const code = buf.readUInt16LE(i);
    if (
      (code >= 0x20 && code <= 0x7E) ||
      (code >= 0xAC00 && code <= 0xD7AF) ||
      (code >= 0x3131 && code <= 0x318E)
    ) {
      current += String.fromCharCode(code);
    } else {
      if (current.trim().length > 3) {
        texts.push(current.trim());
      }
      current = '';
    }
  }
  if (current.trim().length > 3) texts.push(current.trim());

  return texts.join('\n');
}

// ─── PDF 파서 ───
async function parsePDF(buffer) {
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
  const data = await pdfParse(buffer);
  return data.text || '';
}

// ─── DOCX 파서 ───
async function parseDOCX(buffer) {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

// ─── 메인 핸들러 ───
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { filePath, fileType } = req.body;
  if (!filePath || !fileType) {
    return res.status(400).json({ error: 'filePath and fileType required' });
  }

  try {
    // Supabase Storage에서 파일 다운로드
    const { data, error } = await supabase.storage
      .from('documents')
      .download(filePath);

    if (error) {
      return res.status(500).json({ error: `파일 다운로드 실패: ${error.message}` });
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const ext = fileType.toLowerCase();
    let extractedText = '';

    // 파일 형식별 파싱
    if (ext === 'hwpx') {
      extractedText = await parseHWPX(buffer);
    } else if (ext === 'hwp') {
      extractedText = await parseHWP(buffer);
    } else if (ext === 'pdf') {
      extractedText = await parsePDF(buffer);
    } else if (ext === 'docx' || ext === 'doc') {
      extractedText = await parseDOCX(buffer);
    } else if (ext === 'txt' || ext === 'md') {
      extractedText = buffer.toString('utf-8');
    } else {
      return res.status(200).json({
        success: true,
        text: '',
        message: `${ext} 형식은 텍스트 추출을 지원하지 않습니다. 파일은 정상 저장되었습니다.`,
      });
    }

    // 텍스트 정리
    extractedText = extractedText
      .replace(/\n{3,}/g, '\n\n')  // 과도한 빈 줄 제거
      .trim()
      .slice(0, 100000);  // 최대 10만자 제한

    return res.status(200).json({
      success: true,
      text: extractedText,
      charCount: extractedText.length,
      message: extractedText
        ? `${extractedText.length}자 추출 완료`
        : '텍스트를 추출할 수 없었습니다. 파일은 정상 저장되었습니다.',
    });

  } catch (e) {
    console.error('Parse error:', e);
    return res.status(200).json({
      success: true,
      text: '',
      message: `텍스트 추출 중 오류 (${e.message}). 파일은 정상 저장되었습니다.`,
    });
  }
}
