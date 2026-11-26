**العربية** · [English](ARCHITECTURE.md)

# البنية المعمارية لتطبيق Bibalak (نظرة عامة)

يلخّص هذا المستند كيفية تنظيم الشيفرة البرمجية وحدود المسؤوليات في Bibalak. للتفاصيل التقنية الكاملة وسجل القرارات المعمارية، راجع [`docs/architecture/overview.md`](docs/architecture/overview.md) و[`docs/architecture/adr/README.md`](docs/architecture/adr/README.md).

## 1. طبقات البنية النظيفة (Clean Architecture)

تتجه التبعيات نحو الداخل فقط، ويفرض هيكل Cargo Workspace هذه الحدود ([ADR-001](docs/architecture/adr/001-clean-architecture.md)):

```text
crates/bibalak-core       أنواع النطاق والمنافذ (Ports) وحالات الاستخدام (Rust خالص بلا IO أو واجهة)
        ▲
        │ تنفيذ المنافذ
crates/bibalak-db         تخزين SQLite، والترحيلات، ومحرك دمج المزامنة (ADR-014)
crates/bibalak-scheduler  خوارزميتا SM-2 وFSRS-6 النقيتان (ADR-002)
crates/bibalak-ankifmt    استيراد وتصدير .apkg (v2/v3) و.colpkg (v11/v18)
crates/bibalak-search     فهرس بحث FTS5 بالذاكرة مع تطبيع العربية (ADR-009)
crates/bibalak-media      إدارة الوسائط وإزالة التكرار بالبصمة (ADR-010)
crates/bibalak-render     تصيير قوالب البطاقات وCloze وKaTeX
crates/bibalak-plugin     نموذج صلاحيات الإضافات (ADR-003)
crates/bibalak-ai         محوّل HTTP لـ OpenAI/Ollama وخزنة مفاتيح النظام (ADR-013)
        ▲
        │ التكييف مع نظام التشغيل
apps/desktop/src-tauri     غلاف Tauri 2: ربط المضيف وأوامر IPC
        ▲
        │ استدعاءات IPC مُنمّطة + تدفّق DomainEvent
apps/desktop/src           واجهة React 19 + TypeScript (TanStack Router/Query وZustand وTailwind)
```

الحزم المشتركة في TypeScript ضمن `packages/`:

- `packages/ipc-types` — أنواع TypeScript المولّدة تلقائياً من Rust (`ts-rs` عبر `pnpm bindings`).
- `packages/ui-tokens` — رموز التصميم الموحّدة (الألوان، المسافات، الحركة).
- `packages/plugin-sdk` — عقد الإضافات العام المرخّص بـ `MIT` (`@bibalak/plugin-sdk`).

## 2. طبقة IPC ومزامنة الحالة

- **النواة مصدر الحقيقة:** كل عمليات الحفظ والجدولة والتحقق تتم في Rust. أوامر Tauri تحت `apps/desktop/src-tauri/src/commands/` تتحقق من المدخلات وتنفّذ العمل خارج خيط الواجهة الرئيسي عبر `Collection`.
- **استدعاءات الواجهة:** لا تستدعي الشاشات Tauri مباشرةً، بل تمر عبر المغلّف المُنمّط في `apps/desktop/src/lib/ipc.ts`.
- **التحديث الحي:** كل عملية تعديل ناجحة تُطلق `DomainEvent` مُنمّطاً، فتعكس الواجهة ذلك بإبطال مفاتيح TanStack Query في `src/lib/queryKeys.ts`.

## 3. الحدود الأمنية

- **عزل محتوى البطاقات (`CardFace`، [ADR-004](docs/architecture/adr/004-sandboxed-card-frame.md)):** قد تحتوي المجموعات المشتركة على HTML وCSS وJavaScript غير موثوقة. يُصيّر `CardFace` كل وجه داخل `<iframe sandbox="allow-scripts">` بأصل مبهم (opaque origin) دون أي وصول إلى DOM التطبيق أو IPC أو التخزين أو الشبكة، مع تواصل عبر رسائل `postMessage` متحقق منها فقط.
- **عزل الإضافات ([ADR-003](docs/architecture/adr/003-plugin-worker-sandbox.md)):** تعمل الإضافات داخل Web Workers مع فحص الصلاحيات ومنع الخروج عن مجلد الإضافة.
- **سياسة CSP وتحصين IPC ([ADR-029](docs/architecture/adr/029-ipc-security-hardening.md)):** سياسة أمان صارمة في `tauri.conf.json` (يحرسها اختبار `tauriCsp.test.ts`)، وصلاحيات مخصصة لكل نافذة، وتقييد مسارات النسخ الاحتياطي عبر `paths_guard`.
- **خصوصية الذكاء الاصطناعي ([ADR-013](docs/architecture/adr/013-ai-assistant.md)):** معطّل افتراضياً؛ تُحفظ المفاتيح في خزنة نظام التشغيل وتُعرض معاينة نصية قبل أي إرسال.

## 4. البيانات والوضع المحمول ([ADR-006](docs/architecture/adr/006-portable-mode.md))

- **التثبيت الاعتيادي:** يحفظ `collection.sqlite` و`collection.media/` و`backups/` و`plugins/` في مجلد بيانات النظام (`com.keepsake.desktop` عبر `data_dir::data_dir`).
- **الوضع المحمول (Windows):** وجود ملف `portable.txt` بجانب `Bibalak.exe` يوجّه `data_dir` إلى مجلد `./data/` المجاور دون كتابة أي شيء في `%APPDATA%`.
- **النسخ الاحتياطي التلقائي:** نسخة احتياطية يومية عند بدء التشغيل، ونسخة أمان تلقائية `.pre-v<N>.sqlite` قبل أي ترقية لمخطط قاعدة البيانات.

## 5. قاعدة دعم كل المنصات

يستهدف Bibalak أنظمة Windows وmacOS وLinux اليوم مع إبقاء النواة جاهزة للويب والهاتف مستقبلاً:

- تعيش قواعد النطاق في Rust خالص (`bibalak-core` و`-scheduler` و`-render`) بلا اعتماد على واجهات نظام معيّن.
- تعبر جميع مزايا المضيف (النوافذ، الاختصارات العامة، منتقي الملفات، الإشعارات، التحديثات) من خلال واجهات `apps/desktop/src/lib/platform/types.ts` مع قيمة `null` عند غياب الميزة (محروسة باختبار `platformGuard.test.ts`).
- أدوات البناء والفحص والإصدار مكتوبة بـ Node.js وسكربتات متعددة المنصات دون افتراض نظام واحد.

## سجلات القرارات المعمارية الأساسية (ADRs)

- [ADR-001: البنية النظيفة](docs/architecture/adr/001-clean-architecture.md)
- [ADR-002: الجدولة المزدوجة (SM-2 وFSRS-6)](docs/architecture/adr/002-dual-scheduler.md)
- [ADR-003: عزل الإضافات في Web Workers](docs/architecture/adr/003-plugin-worker-sandbox.md)
- [ADR-004: عزل إطار البطاقة (`CardFace`)](docs/architecture/adr/004-sandboxed-card-frame.md)
- [ADR-006: الوضع المحمول](docs/architecture/adr/006-portable-mode.md)
- [ADR-014: سجل المزامنة ومحرك الدمج](docs/architecture/adr/014-sync-journal.md)
- [ADR-021: التحديثات داخل التطبيق](docs/architecture/adr/021-in-app-updates.md)
- [ADR-022: نموذج المصدر المفتوح](docs/architecture/adr/022-open-source-model.md)
- [ADR-028: خطة التنبيهات في النواة](docs/architecture/adr/028-reminders-core-plan.md)
- [ADR-029: تحصين أمان IPC](docs/architecture/adr/029-ipc-security-hardening.md)
