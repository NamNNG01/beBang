/**
 * Gemini AI Service for Backend
 *
 * Gọi Google Gemini API với:
 * - System API key (từ .env)
 * - Retry logic với exponential backoff
 * - JSON response parsing và fixing
 * - Các prompts cho formula, analysis, guide
 */

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// Model mặc định - dùng gemini-2.5-flash (ổn định, nhanh)
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

const ALLOWED_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "deepseek-r1-distill-llama-70b",
  "qwen/qwen3-32b",
];

// Cache model đã chọn
let cachedModel = DEFAULT_MODEL;

/**
 * Lấy API key từ environment
 */
function getApiKey() {
  const key = process.env.GROQ_API_KEY;

  if (!key || !key.trim()) {
    throw new Error("GROQ_API_KEY không được cấu hình!");
  }

  return key.trim();
}

/**
 * Clean AI response to extract pure JSON
 */
function cleanJSONResponse(text) {
  if (!text) return "{}";

  let cleaned = text.trim();

  // Remove markdown code fences (```json, ```, ```)
  cleaned = cleaned.replace(/^```(?:json)?\s*/gm, "");
  cleaned = cleaned.replace(/```\s*$/gm, "");

  // Remove any text before first { and after last }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  cleaned = cleaned.replace(/,\s*}/g, "}");
  cleaned = cleaned.replace(/,\s*]/g, "]");

  return cleaned;
}

/**
 * Fix placeholder <<Q>> trong công thức thành dấu nháy kép
 */
function fixFormulaPlaceholder(formula) {
  if (!formula || typeof formula !== "string") return formula;
  return formula.replace(/<<Q>>/g, '"');
}

/**
 * Fallback: Trích xuất công thức từ raw text khi JSON parse fail
 */
function extractFormulaFromText(text) {
  // Ưu tiên 1: Tìm "formula": "..." trong text
  const formulaFieldMatch = text.match(/"formula"\s*:\s*"([\s\S]*?)"/);
  if (formulaFieldMatch && formulaFieldMatch[1]) {
    return fixFormulaPlaceholder(formulaFieldMatch[1]);
  }

  // Ưu tiên 2: Tìm dòng bắt đầu bằng =
  const formulaLineMatch = text.match(/^\s*(=.+)$/m);
  if (formulaLineMatch && formulaLineMatch[1]) {
    return fixFormulaPlaceholder(formulaLineMatch[1].trim());
  }

  return null;
}

/**
 * List available models
 */
async function listModels() {
  const apiKey = getApiKey();
  const url = `${GEMINI_BASE_URL}/models?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    const models = Array.isArray(data?.models)
      ? data.models.map((m) => m.name.replace("models/", ""))
      : [];
    return models;
  } catch (error) {
    console.error("List models error:", error);
    return [];
  }
}

/**
 * Pick available model from preferred list
 */
async function pickAvailableModel() {
  const availableModels = await listModels();
  const modelSet = new Set(availableModels);

  // Fallback to default
  return availableModels[0] || DEFAULT_MODEL;
}

/**
 * Call Gemini API with retry logic and signal support
 */
async function callGenerateContent(modelName, payload, options = {}) {
  const { signal: externalSignal } = options;

  const apiKey = getApiKey();

  try {
    const controller = new AbortController();

    const timeoutId = setTimeout(() => controller.abort(), 60000);

    if (externalSignal) {
      externalSignal.addEventListener("abort", () => {
        controller.abort();
        clearTimeout(timeoutId);
      });
    }

    // Chuyển payload Gemini -> text prompt
    let promptText = "";

    if (payload?.contents?.[0]?.parts?.[0]?.text) {
      promptText = payload.contents[0].parts[0].text;
    }

    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelName,

        messages: [
          {
            role: "user",
            content: promptText,
          },
        ],

        temperature: 0.2,

        max_tokens: 8192,
      }),

      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data?.error?.message || `HTTP ${response.status}`;

      const errorCode = response.status;

      if (errorCode === 400) {
        throw new Error(`❌ Request không hợp lệ: ${errorMsg}`);
      }

      if (errorCode === 401 || errorCode === 403) {
        throw new Error("❌ API Key không hợp lệ!");
      }

      if (errorCode === 429) {
        throw new Error("❌ Quá nhiều requests!");
      }

      throw new Error(`❌ Lỗi API (${errorCode}): ${errorMsg}`);
    }

    const text = data?.choices?.[0]?.message?.content || "";

    if (!text.trim()) {
      throw new Error("❌ AI trả về response rỗng!");
    }

    return { text };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`❌ 429 Rate Limit: ${JSON.stringify(data)}`);
    }

    throw error;
  }
}

/**
 * Đảm bảo có model - validate và return
 */
function ensureModel(requestedModel) {
  // Nếu có model từ request và nằm trong whitelist
  if (requestedModel && ALLOWED_MODELS.includes(requestedModel)) {
    console.log(`🤖 Using requested model: ${requestedModel}`);
    return requestedModel;
  }
  // Fallback to default
  console.log(`🤖 Using default model: ${DEFAULT_MODEL}`);
  return cachedModel || DEFAULT_MODEL;
}

// ============================================================================
// PROMPTS TEMPLATES
// ============================================================================

const FORMULA_SYSTEM_PROMPT = `Bạn là CHUYÊN GIA EXCEL (15 năm kinh nghiệm), chuyên sâu về Excel 365/2024.
Nhiệm vụ: Tạo công thức Excel chính xác, hiện đại, và trả về kết quả dưới dạng JSON.

⚠️ QUAN TRỌNG: CHỈ TRẢ VỀ JSON THUẦN TÚY. KHÔNG GIẢI THÍCH, KHÔNG SUY LUẬN, KHÔNG VIẾT CHỮ TRƯỚC/SAU JSON.

---
QUY TẮC CỐT LÕI (BẮT BUỘC TUÂN THỦ):

1. NGUỒN DỮ LIỆU (CONTEXT IS KING):
   - CHỈ sử dụng tên Bảng/Cột/Range được cung cấp trong [CONTEXT].
   - TUYỆT ĐỐI KHÔNG bịa ra tên cột không tồn tại (Hallucination).

2. CÚ PHÁP THAM CHIẾU (SYNTAX):
   - Ưu tiên số 1: Nếu Context có "NAMED TABLES" → Bắt buộc dùng Structured Reference (Ví dụ: Table1[Column]).
   - Ưu tiên số 2: Nếu KHÔNG có Table → Dùng địa chỉ vùng (Ví dụ: Sheet1!A2:A100).

3. XỬ LÝ KIỂU DỮ LIỆU (CHỐNG LỖI LOGIC):
   - Cảnh giác với các cột trạng thái (Status, Active, Paid...):
     + KHÔNG ĐƯỢC MẶC ĐỊNH là Boolean (TRUE/FALSE) chỉ qua tên cột.
     + HÃY KIỂM TRA "Sample Data" trong Context (nếu có) để xem là "Y"/"N", "Yes"/"No", hay 1/0.
     + Nếu KHÔNG có Sample Data: Hãy ưu tiên dùng so sánh chuỗi phổ biến (như "Yes", "Active") hoặc giải thích rõ trong phần "explanation".
   - Ngày tháng: Luôn dùng hàm DATE(y,m,d) để so sánh, tránh lỗi định dạng vùng miền (dd/mm vs mm/dd).

4. HÀM HIỆN ĐẠI & TỐI ƯU:

   * MẶC ĐỊNH: Luôn ưu tiên công thức tương thích Excel 2016/2019.
   * KHÔNG sử dụng các hàm chỉ có trên Excel 365/2024 trừ khi người dùng YÊU CẦU RÕ RÀNG.

   ⚠️ CẤM dùng mặc định:

   * LET
   * LAMBDA
   * MAP
   * BYROW
   * BYCOL
   * SCAN
   * REDUCE
   * TAKE
   * DROP
   * VSTACK
   * HSTACK
   * TOCOL
   * TOROW
   * CHOOSECOLS
   * CHOOSEROWS
   * WRAPROWS
   * WRAPCOLS
   * EXPAND
   * FILTERXML
   * Dynamic Array spill syntax

   ✅ Ưu tiên:

   * IF

   * AND

   * OR

   * INDEX

   * MATCH

   * VLOOKUP

   * HLOOKUP

   * SUMIFS

   * COUNTIFS

   * IFERROR

   * SUMPRODUCT

   * OFFSET

   * INDIRECT

   * AGGREGATE

   * Nếu có thể giải bằng hàm cũ -> BẮT BUỘC dùng hàm cũ.

   * Chỉ dùng XLOOKUP/FILTER/UNIQUE/SORT nếu user ghi rõ:

     * "Excel 365"
     * "Excel mới"
     * "Dynamic Array"
     * "Office 2024"

   * KHÔNG trả về công thức mảng động.

   * KHÔNG dùng range kiểu A1:A100 trong IF/AND/OR trực tiếp.

   * Mọi công thức phải hoạt động khi kéo xuống từng dòng trên Excel 2016.

   Ví dụ đúng:
   =IF(AND(A2>5,B2<10),"Dung","Sai")

   Ví dụ sai:
   =MAP(A2:A10,LAMBDA(x,x*2))

   Ví dụ sai:
   =LET(x,A2:A10,SUM(x))

   Ví dụ sai:
   =IF(A2:A10>5,"Dung","Sai")


5. ĐỊNH DẠNG ĐẦU RA (FORMATTING):
   - Dấu phân cách: Luôn dùng DẤU PHẨY (,) theo chuẩn US.
   - Chuỗi văn bản (String): Dùng ký tự thay thế <<Q>> thay cho dấu nháy kép (").
     Ví dụ: =COUNTIF(Products[Active], <<Q>>Y<<Q>>)

---
OUTPUT: CHỈ TRẢ VỀ JSON, KHÔNG CÓ GÌ KHÁC!
{
  "formula": "Chuỗi công thức bắt đầu bằng dấu =",
  "explanation": "Giải thích ngắn gọn (dưới 30 từ)",
  "example": "Ví dụ minh họa kết quả"
}`;

const ANALYSIS_SYSTEM_PROMPT = `Bạn là DATA ANALYST chuyên nghiệp. Nhiệm vụ: Phân tích dữ liệu và trả về JSON.

NGUYÊN TẮC CỐT LÕI:
1. DATA SCOPE: Phân tích TẤT CẢ các bảng trong context.
2. ACCURACY: Dùng rowCount thực tế. KHÔNG đếm thủ công trên sample nếu có meta-data.
3. DATE HANDLING:
   - Nhận diện số 30000-60000 là Excel Date Serial.
   - Cố gắng convert sang DD/MM/YYYY.
   - Nếu không tính toán chính xác được, giữ nguyên số và ghi chú "(Excel Serial)".
4. NO HALLUCINATION:
   - Nếu không có dữ liệu thời gian -> KHÔNG bịa ra "Trends".
   - Nếu dữ liệu không rõ ràng -> Trả về mảng rỗng [] thay vì đoán.
5. NGÔN NGỮ: 100% Tiếng Việt (kể cả key metrics, description).

ĐỊNH DẠNG OUTPUT (BẮT BUỘC):
- Chỉ trả về RAW JSON.
- KHÔNG dùng Markdown block (\`\`\`json).
- KHÔNG có lời dẫn đầu/cuối.
- Bắt đầu ngay bằng ký tự "{".

JSON SCHEMA:
{
  "summary": "Tóm tắt tổng quan dữ liệu (String)",
  "keyMetrics": [
    {"label": "Tên chỉ số (String)", "value": "Giá trị kèm đơn vị (String)"}
  ],
  "trends": [
    {
      "type": "positive|negative|neutral",
      "description": "Mô tả xu hướng. Nếu không có dữ liệu thời gian, để trống mảng này."
    }
  ],
  "insights": ["Các điểm nổi bật tìm thấy từ dữ liệu"],
  "recommendations": ["Đề xuất hành động dựa trên data"],
  "warnings": ["Cảnh báo về chất lượng dữ liệu (VD: thiếu dữ liệu, date lỗi...)"],
  "chartSuggestion": {
    "type": "column|line|pie|bar|area|doughnut|scatter|null",
    "title": "Tên biểu đồ đề xuất",
    "description": "Giải thích tại sao chọn biểu đồ này. Nếu không thể vẽ, để null.",
    "dataRange": "Range dữ liệu cho biểu đồ (VD: A1:D10). Lấy từ usedRange trong context."
  },
  "pivotSuggestion": {
    "recommended": true,
    "rowFields": ["Tên cột text để làm Row (Group by)"],
    "valueFields": ["Tên cột số để làm Value (SUM/AVG)"],
    "columnFields": ["Tên cột date/category cho Column (optional, có thể rỗng)"],
    "filterFields": ["Tên cột để lọc (optional, có thể rỗng)"],
    "description": "Giải thích cấu trúc PivotTable đề xuất. Nếu không phù hợp, recommended=false."
  }
}`;

const GUIDE_SYSTEM_PROMPT = `Bạn là GIÁO VIÊN EXCEL cho NGƯỜI MỚI BẮT ĐẦU. Viết hướng dẫn CỰC KỲ CHI TIẾT.

BẮT BUỘC: CHỈ TRẢ VỀ JSON THUẦN TÚY. KHÔNG có text nào khác ngoài JSON.

QUY TẮC QUAN TRỌNG:
1. HƯỚNG DẪN NHƯ NGƯỜI DÙNG CHƯA BIẾT GÌ VỀ EXCEL
2. CHỈ RÕ VỊ TRÍ CHÍNH XÁC - đừng nói "Get Data from Table" mà phải nói:
   - "Nhìn lên thanh menu phía trên cùng"
   - "Click tab Data (tab thứ 4 từ trái)"
   - "Trong nhóm Get & Transform Data, click nút From Table/Range"
3. PHÂN BIỆT CLICK TRÁI/PHẢI:
   - "Click chuột TRÁI vào ô A1"
   - "Click chuột PHẢI vào ô đã chọn > chọn Format Cells"
4. MÔ TẢ ICON NẾU CẦN:
   - "Nút Insert Function (biểu tượng fx bên trái thanh công thức)"
5. PHÍM TẮT: Luôn đề cập nếu có
6. NẾU CÓ CONTEXT: Sử dụng tên cột/sheet/table thực tế từ context được cung cấp thay vì A, B, C

JSON OUTPUT (copy chính xác format này):
{
  "taskName": "Tên task ngắn gọn",
  "steps": [
    {
      "title": "Tiêu đề bước",
      "description": "Mô tả chi tiết với vị trí chính xác",
      "details": ["Hành động cụ thể 1", "Hành động cụ thể 2"],
      "cellToHighlight": "A1:D10 (optional - ô cần chọn)",
      "tips": "Mẹo hữu ích (optional)",
      "warning": "Lưu ý quan trọng (optional)"
    }
  ]
}`;

const CHART_SYSTEM_PROMPT = `Bạn là CHUYÊN GIA VISUALIZATION. Phân tích dữ liệu và đề xuất biểu đồ phù hợp.

BẮT BUỘC: CHỈ TRẢ VỀ JSON THUẦN TÚY.

CHART TYPES (sử dụng đúng tên):
- ColumnClustered: So sánh giá trị
- Line: Xu hướng theo thời gian
- Pie: Tỷ lệ phần trăm
- BarClustered: So sánh ngang
- Area: Xu hướng tích lũy
- XYScatter: Tương quan 2 biến

QUY TẮC:
1. Phân tích CONTEXT để hiểu cấu trúc dữ liệu
2. Chọn chartType phù hợp nhất với yêu cầu
3. dataRange phải là vùng chứa data (bao gồm header)
4. title ngắn gọn, mô tả nội dung chart

JSON OUTPUT:
{
  "chartType": "ColumnClustered",
  "dataRange": "A1:D10",
  "title": "Doanh thu theo tháng",
  "seriesBy": "columns"
}`;

const VBA_SYSTEM_PROMPT = `Bạn là CHUYÊN GIA VBA EXCEL chuyên nghiệp (15 năm kinh nghiệm).

NHIỆM VỤ: Viết code VBA hoàn chỉnh, chạy được ngay, tương thích Excel 2016+.

QUY TẮC CỐT LÕI (BẮT BUỘC):
1. PHẠM VI DỮ LIỆU (TÙY THEO YÊU CẦU NGƯỜI DÙNG):
   - Nếu người dùng đề cập "ô đã chọn", "selection", "vùng chọn" -> dùng Selection.
   - Nếu KHÔNG đề cập -> TỰ ĐỘNG phát hiện: dùng UsedRange hoặc ListObjects.
   - Ưu tiên ListObjects nếu có Table trong sheet.
2. UNICODE AN TOÀN TRONG CODE:
   - CHỈ TRONG CODE VBA: KHÔNG viết ký tự có dấu tiếng Việt.
   - Thay thế: "Da hoan thanh" thay vì "Đã hoàn thành".
   - Ký tự đặc biệt (₫) -> dùng ChrW(8363).
3. CODE CHUẨN:
   - Sub/Function tên rõ ràng, không dấu.
   - Dim biến đầy đủ.
   - On Error GoTo ErrorHandler.
   - MsgBox thông báo kết quả (không dấu).
4. ĐỊNH DẠNG JSON:
   - Trả về DUY NHẤT 1 JSON object, KHÔNG markdown.
   - Bắt đầu bằng "{".

5. COPY-PASTE-RUN REQUIREMENT (BẮT BUỘC)

- Code phải chạy được ngay sau khi:
  Alt+F11 -> Insert Module -> Paste -> F5

- KHÔNG được hard-code tên sheet trừ khi user chỉ định rõ.

- Mặc định dùng:

    Set ws = ActiveSheet

- KHÔNG được yêu cầu người dùng sửa code thủ công.

- Nếu cần sheet:
    dùng ActiveSheet.

- Nếu cần vùng dữ liệu:
    dùng UsedRange.

- Nếu cần vùng chọn:
    dùng Selection.

- Code phải hoạt động trên workbook bất kỳ.

- Luôn thêm ErrorHandler.

Ví dụ:

On Error GoTo ErrorHandler

...

Exit Sub

ErrorHandler:
    MsgBox "Loi: " & Err.Description

JSON SCHEMA:
{
  "macroName": "Tên macro (không dấu)",
  "description": "Mô tả chức năng (tiếng Việt có dấu OK)",
  "code": "Code VBA escape chuẩn JSON, KHÔNG ký tự có dấu",
  "howToUse": ["Bước 1", "Bước 2"],
  "warnings": ["Cảnh báo nếu có"]
}`;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generate Excel formula from prompt
 * @param {string} prompt - User's request
 * @param {object} excelContext - Excel context data
 * @param {object} options - { signal }
 */
export async function generateFormula(
  prompt,
  excelContext = null,
  options = {},
) {
  const { signal, model } = options;
  const selectedModel = ensureModel(model);

  let userPrompt = `Yêu cầu: ${prompt}`;

  if (excelContext) {
    userPrompt = formatContextForPrompt(excelContext) + userPrompt;

    // Add range hints
    if (excelContext.rowCount) {
      userPrompt += `\n\n⚠️ LƯU Ý: Excel có ${excelContext.rowCount} hàng. Data từ hàng 2-${excelContext.rowCount}.`;
      userPrompt += `\nDùng range CỤ THỂ, KHÔNG dùng toàn cột!`;
    }
  }

  const payload = {
    contents: [
      {
        parts: [
          {
            text: `${FORMULA_SYSTEM_PROMPT}\n\n${userPrompt}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      // QUAN TRỌNG: Bắt buộc Gemini 3 trả về JSON thuần túy
      responseMimeType: "application/json",
    },
  };

  const result = await callGenerateContent(selectedModel, payload, options);
  const cleanText = cleanJSONResponse(result.text);

  try {
    const parsed = JSON.parse(cleanText);
    if (parsed.formula) {
      parsed.formula = fixFormulaPlaceholder(parsed.formula);
    }
    return parsed;
  } catch (parseError) {
    console.warn("JSON Parse failed, attempting fallback extraction...");

    // Fallback: Dùng extractFormulaFromText
    const extractedFormula = extractFormulaFromText(result.text);
    if (extractedFormula) {
      return {
        formula: extractedFormula,
        explanation: "Đã trích xuất công thức từ JSON lỗi định dạng.",
        example: "",
      };
    }

    // Fallback cuối: Trả về text từ AI
    return {
      formula: "",
      explanation: result.text.substring(0, 500),
      example: "",
    };
  }
}

/**
 * Analyze Excel data
 * @param {object} excelContext - Excel context
 * @param {object} options - { signal }
 */
export async function analyzeData(excelContext, options = {}) {
  if (!excelContext) {
    throw new Error("Excel context không được rỗng!");
  }
  if (!excelContext.sampleData || excelContext.sampleData.length === 0) {
    throw new Error("Không có dữ liệu để phân tích!");
  }

  const { signal, model } = options;
  const selectedModel = ensureModel(model);

  const contextText = formatContextForPrompt(excelContext);
  const userPrompt = `${contextText}

PHÂN TÍCH dữ liệu trên:
1. Tìm CỘT SỐ (number type)
2. Tính: Tổng, TB, Max, Min
3. Tìm patterns, insights
4. Đề xuất actions

⚠️ CHỈ dùng số từ data, KHÔNG đoán.`;

  const payload = {
    contents: [
      {
        parts: [
          {
            text: `${ANALYSIS_SYSTEM_PROMPT}\n\n${userPrompt}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  };

  const result = await callGenerateContent(selectedModel, payload, options);
  const cleanText = cleanJSONResponse(result.text);

  try {
    return JSON.parse(cleanText);
  } catch (error) {
    console.error("JSON Parse Error:", error);

    // Fallback: Trích xuất insights từ raw text
    const summary = result.text.substring(0, 200);
    const insights = [];

    // Tìm các câu quan trọng
    const sentences = result.text
      .split(/[.!?]\s+/)
      .filter((s) => s.length > 20);
    insights.push.apply(insights, sentences.slice(0, 3));

    return {
      summary: summary || "Đã đọc dữ liệu nhưng gặp lỗi định dạng.",
      keyMetrics: [],
      trends: [],
      insights:
        insights.length > 0 ? insights : ["Dữ liệu đã được đọc thành công"],
      recommendations: ["Thử lại để nhận phân tích chi tiết"],
      warnings: [],
      chartSuggestion: null,
    };
  }
}

/**
 * Generate step-by-step guide
 * @param {string} task - Task description
 * @param {object} options - { signal }
 */
export async function generateGuide(task, excelContext = null, options = {}) {
  if (!task || !task.trim()) {
    throw new Error("Task description không được rỗng!");
  }

  const { signal, model } = options;
  const selectedModel = ensureModel(model);

  // Format context nếu có
  let contextSection = "";
  if (excelContext) {
    contextSection = `\n\n[EXCEL CONTEXT]
Sheet hiện tại: ${excelContext.sheetName || "Sheet1"}
Columns: ${excelContext.columns?.join(", ") || "N/A"}
${excelContext.namedTables ? `Named Tables: ${excelContext.namedTables}` : ""}
${excelContext.sampleData ? `Sample Data:\n${JSON.stringify(excelContext.sampleData.slice(0, 3), null, 2)}` : ""}
[END CONTEXT]`;
  }

  const payload = {
    contents: [
      {
        parts: [
          {
            text: `${GUIDE_SYSTEM_PROMPT}${contextSection}\n\nTask: ${task}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 10240,
      responseMimeType: "application/json",
    },
  };

  const result = await callGenerateContent(selectedModel, payload, options);
  const cleanText = cleanJSONResponse(result.text);

  try {
    const parsed = JSON.parse(cleanText);
    if (!parsed.taskName || !parsed.steps || !Array.isArray(parsed.steps)) {
      throw new Error("Invalid response structure");
    }
    return parsed;
  } catch (error) {
    console.error("JSON Parse Error:", error);

    // Fallback: Trích xuất steps từ raw text
    const lines = result.text.split("\n").filter((l) => l.trim());
    const steps = [];

    // Tìm các bước (dòng bắt đầu bằng số hoặc -, •)
    lines.forEach((line) => {
      if (/^[\d\-•]/.test(line.trim())) {
        steps.push({
          title: line.trim().replace(/^[\d\-•.)\s]+/, ""),
          description: "",
          details: [],
          tips: "",
          warning: "",
        });
      }
    });

    if (steps.length > 0) {
      return {
        taskName: task,
        steps: steps,
      };
    }

    throw new Error("Không thể trích xuất hướng dẫn. Thử mô tả ngắn gọn hơn!");
  }
}

/**
 * Generate chart configuration from prompt and Excel context
 * @param {string} prompt - User's description of what chart to create
 * @param {object} excelContext - Excel context data (required for chart)
 * @param {object} options - { signal, model }
 */
export async function generateChartConfig(
  prompt,
  excelContext = null,
  options = {},
) {
  if (!prompt || !prompt.trim()) {
    throw new Error("Mô tả biểu đồ không được rỗng!");
  }

  console.log("📊 Generating Chart Config for:", prompt.substring(0, 50));

  try {
    const { signal, model } = options;
    const selectedModel = ensureModel(model);

    // Format context
    let contextSection = "";
    if (excelContext) {
      contextSection = `\n\n[EXCEL CONTEXT]
Sheet: ${excelContext.sheetName || "Sheet1"}
Columns: ${excelContext.columns?.join(", ") || "N/A"}
${excelContext.sampleData ? `Sample Data:\n${JSON.stringify(excelContext.sampleData.slice(0, 5), null, 2)}` : ""}
[END CONTEXT]`;
    }

    const payload = {
      contents: [
        {
          parts: [
            {
              text: `${CHART_SYSTEM_PROMPT}${contextSection}\n\nYêu cầu: ${prompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    };

    const result = await callGenerateContent(selectedModel, payload, {
      signal,
    });
    const cleanText = cleanJSONResponse(result.text);

    const parsed = JSON.parse(cleanText);
    if (!parsed.chartType || !parsed.dataRange) {
      throw new Error("Invalid chart config: missing chartType or dataRange");
    }

    return parsed;
  } catch (error) {
    console.error("Chart Config Generation Error:", error);
    throw new Error(`Lỗi tạo biểu đồ: ${error.message}`);
  }
}

/**
 * Generate VBA/Macro code from description
 * @param {string} description - User's description of what the macro should do
 * @param {object} excelContext - Excel context data (optional)
 * @param {object} options - { signal }
 */
export async function generateVBA(
  description,
  excelContext = null,
  options = {},
) {
  if (!description || !description.trim()) {
    throw new Error("Mô tả macro không được rỗng!");
  }

  console.log("📝 Generating VBA for:", description.substring(0, 50));

  try {
    const { signal, model } = options;
    const selectedModel = ensureModel(model);

    let userPrompt = `Yêu cầu: ${description}`;

    // VBA chỉ cần structure info, không cần sample data (tránh timeout)
    if (excelContext) {
      console.log("📊 Excel context detected, formatting lightweight...");
      try {
        userPrompt = formatLightweightContext(excelContext) + userPrompt;
      } catch (ctxErr) {
        console.error("❌ Error formatting VBA context:", ctxErr);
        // Continue even if context formatting fails
      }
    }

    const payload = {
      contents: [
        {
          parts: [
            {
              text: `${VBA_SYSTEM_PROMPT}\n\n${userPrompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    };

    console.log("🚀 Calling Gemini for VBA...");
    const result = await callGenerateContent(selectedModel, payload, options);
    const cleanText = cleanJSONResponse(result.text);

    try {
      const parsed = JSON.parse(cleanText);
      if (!parsed.code || !parsed.macroName) {
        throw new Error("Invalid VBA response structure");
      }
      console.log("✅ VBA generated successfully!");
      return parsed;
    } catch (error) {
      console.warn("JSON Parse failed for VBA, attempting code extraction...");

      // Fallback: Tìm code VBA trong raw text
      const codeMatch =
        result.text.match(/```vba([\s\S]*?)```/i) ||
        result.text.match(/```([\s\S]*?)```/) ||
        result.text.match(/(Sub\s+\w+[\s\S]*?End Sub)/i);

      if (codeMatch && codeMatch[1]) {
        console.log("✅ VBA extracted via fallback!");
        return {
          macroName: "GeneratedMacro",
          description: description,
          code: codeMatch[1].trim(),
          howToUse: [
            "Mở VBA Editor (Alt+F11)",
            "Insert → Module",
            "Paste code vào module",
            "Chạy macro (F5)",
          ],
          warnings: [],
        };
      }

      throw new Error("Không thể tạo VBA code. Thử mô tả cụ thể hơn!");
    }
  } catch (err) {
    console.error("❌ generateVBA main error:", err);
    throw err; // Re-throw to be caught by controller
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format Excel context thành text cho AI prompt
 */
function formatContextForPrompt(context) {
  if (!context) return "";

  let contextText = "\nCONTEXT TỪ EXCEL HIỆN TẠI:\n";
  contextText +=
    "═══════════════════════════════════════════════════════════════════\n";

  // Sheet info + VỊ TRÍ QUAN TRỌNG
  contextText += `Sheet: ${context.sheetName}\n`;
  contextText += `Vùng dữ liệu: ${context.usedRange}\n`;

  // THÔNG TIN VỊ TRÍ CHÍNH XÁC
  if (context.startRow) {
    contextText += `Header bắt đầu từ hàng: ${context.startRow}\n`;
    contextText += `Data bắt đầu từ hàng: ${context.startRow + 1}\n`;
  }

  // Ô đang được chọn - RẤT QUAN TRỌNG cho việc tạo công thức
  if (context.selectedCell) {
    contextText += `Ô đang chọn: ${context.selectedCell.address} (Hàng ${context.selectedCell.row}, Cột ${context.selectedCell.column})\n`;
  }
  contextText += "\n";

  // Headers and columns VỚI ĐỊA CHỈ CHÍNH XÁC
  if (context.columns && context.columns.length > 0) {
    contextText += "CẤU TRÚC CỘT (với địa chỉ thực tế):\n";
    context.columns.forEach((col) => {
      if (col && col.hasData) {
        contextText += `  - Cột ${col.column || "?"} "${col.name || "Untitled"}": ${col.type || "unknown"}`;
        // Thêm data range thực tế
        if (col.dataRange) {
          contextText += ` [Range: ${col.dataRange}]`;
        }
        if (col.sampleData && col.sampleData.length > 0) {
          contextText += ` (VD: ${col.sampleData.slice(0, 2).join(", ")})`;
        }
        contextText += `\n`;
      }
    });
  }

  // Raw data preview với địa chỉ ô chính xác
  if (context.rawDataPreview && context.rawDataPreview.length > 0) {
    contextText += `\nDỮ LIỆU VỚI ĐỊA CHỈ Ô:\n`;
    context.rawDataPreview.forEach((rowData) => {
      if (!rowData) return;
      contextText += `  Hàng ${rowData.row}: `;
      const cells = rowData.cells
        ? Object.entries(rowData.cells).slice(0, 5)
        : [];
      contextText += cells.map(([addr, val]) => `${addr}="${val}"`).join(", ");
      contextText += "\n";
    });
  } else if (context.sampleData && context.sampleData.length > 0) {
    // Fallback to old format
    const startRow = context.startRow || 1;
    contextText += `\nDỮ LIỆU MẪU:\n`;
    context.sampleData.forEach((row) => {
      if (!row) return;
      const rowNum = row._rowNumber || "?";
      contextText += `  Hàng ${rowNum}: `;
      const entries = Object.entries(row)
        .filter(([k]) => k !== "_rowNumber")
        .slice(0, 5);
      contextText += entries.map(([k, v]) => `${k}=${v}`).join(", ");
      contextText += "\n";
    });
  }

  // NAMED TABLES (Excel Tables created with Ctrl+T)
  if (context.namedTables && context.namedTables.length > 0) {
    contextText += `\nNAMED TABLES (Excel Tables):\n`;
    context.namedTables.forEach((table) => {
      if (!table) return;
      const cols = table.columns ? table.columns.join(", ") : "unknown";
      contextText += `  - Table "${table.name}":\n`;
      contextText += `    Columns: ${cols}\n`;
      contextText += `    Data Range: ${table.dataRange} (${table.rowCount} rows)\n`;
      contextText += `    Có thể dùng: ${table.name}[ColumnName] trong công thức\n`;
    });
    contextText += `\n  GỢI Ý: Dùng Table references như Customers[CustomerID], Orders[Qty] thay vì A:A, B:B\n`;
  }

  contextText +=
    "═══════════════════════════════════════════════════════════════════\n\n";

  return contextText;
}

/**
 * Format lightweight context cho VBA - chỉ structure, không data
 * Giúp giảm token count và tránh timeout
 */
function formatLightweightContext(context) {
  if (!context) return "";

  let contextText = "\nEXCEL STRUCTURE INFO:\n";
  contextText += "───────────────────────────────────────\n";

  try {
    // Basic info
    contextText += `Sheet: ${context.sheetName || "Sheet1"}\n`;
    contextText += `Data Range: ${context.usedRange || "A1:?"}\n`;
    contextText += `Size: ${context.rowCount || "?"} rows × ${context.columnCount || "?"} cols\n`;

    // Headers only (max 15)
    if (
      context.headers &&
      Array.isArray(context.headers) &&
      context.headers.length > 0
    ) {
      const headers = context.headers.slice(0, 15);
      contextText += `Columns: ${headers.join(", ")}${context.headers.length > 15 ? "..." : ""}\n`;
    }

    // Column types (without sample data)
    if (
      context.columns &&
      Array.isArray(context.columns) &&
      context.columns.length > 0
    ) {
      const colTypes = context.columns
        .filter((c) => c && c.hasData)
        .slice(0, 10)
        .map(
          (c) =>
            `${c.column || "?"}:${c.name || "Untitled"}(${c.type || "unknown"})`,
        )
        .join(", ");
      if (colTypes) {
        contextText += `Column Types: ${colTypes}\n`;
      }
    }

    // Named Tables (important for VBA)
    if (
      context.namedTables &&
      Array.isArray(context.namedTables) &&
      context.namedTables.length > 0
    ) {
      contextText += `\nNamed Tables:\n`;
      context.namedTables.forEach((table) => {
        if (!table) return;
        const cols = table.columns
          ? table.columns.slice(0, 8).join(", ")
          : "unknown";
        contextText += `  - ${table.name || "Table"}: ${cols}${
          table.columns && table.columns.length > 8 ? "..." : ""
        } (${table.rowCount || "?"} rows)\n`;
      });
    }

    // SAMPLE DATA (2-3 rows để AI hiểu format dữ liệu)
    if (
      context.sampleData &&
      Array.isArray(context.sampleData) &&
      context.sampleData.length > 0
    ) {
      const sampleRows = context.sampleData.slice(0, 3);
      contextText += `\nSample Data (${sampleRows.length} rows):\n`;
      sampleRows.forEach((row, idx) => {
        if (!row) return;
        const rowNum = row._rowNumber || idx + 2;
        const entries = Object.entries(row)
          .filter(([k]) => k !== "_rowNumber")
          .slice(0, 6);
        const rowStr = entries.map(([k, v]) => `${k}="${v}"`).join(", ");
        contextText += `  Row ${rowNum}: ${rowStr}${Object.keys(row).length > 7 ? "..." : ""}\n`;
      });
    }
  } catch (err) {
    console.error("❌ Error in formatLightweightContext:", err);
    contextText += "[Error extracting full structure info]\n";
  }

  contextText += "───────────────────────────────────────\n\n";

  return contextText;
}
