"""
Generate proposal PDF for tbl_user_credit_transaction — polished v2.
- Removed time-estimate section
- Per-column table explanation
- Real-world flow diagram
- Better visual hierarchy
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Preformatted, HRFlowable, KeepTogether
)

# ── Fonts (Tahoma ships with Windows; supports Thai) ──
pdfmetrics.registerFont(TTFont('Tahoma',      'C:/Windows/Fonts/tahoma.ttf'))
pdfmetrics.registerFont(TTFont('Tahoma-Bold', 'C:/Windows/Fonts/tahomabd.ttf'))
FONT, FONT_BOLD = 'Tahoma', 'Tahoma-Bold'

# ── Petabyte palette ──
PB_BLUE   = HexColor('#2563eb')
PB_NAVY   = HexColor('#1e3a8a')
PB_INDIGO = HexColor('#5a4fcf')
PB_SOFT   = HexColor('#eaf2ff')
PB_LINE   = HexColor('#c7dbff')
PB_GRAY   = HexColor('#64748b')
PB_GRAY2  = HexColor('#94a3b8')
PB_LIGHT  = HexColor('#f8fafc')
PB_BORDER = HexColor('#e2e8f0')
PB_GREEN  = HexColor('#16a34a')
PB_GREEN_BG = HexColor('#dcfce7')
PB_RED    = HexColor('#dc2626')
PB_RED_BG = HexColor('#fee2e2')
PB_AMBER  = HexColor('#d97706')
PB_AMBER_BG = HexColor('#fef3c7')
PB_CODE_BG = HexColor('#f1f5f9')

OUT = os.path.join(os.path.dirname(__file__), 'proposal-user-credit-transaction.pdf')

# ── Style helpers ──
def style(name, **kw):
    base = dict(fontName=FONT, fontSize=10, leading=15, textColor=black, spaceAfter=4)
    base.update(kw)
    return ParagraphStyle(name, **base)

TITLE     = style('Title',    fontName=FONT_BOLD, fontSize=26, leading=32, textColor=PB_NAVY,  spaceAfter=2)
KICKER    = style('Kicker',   fontName=FONT_BOLD, fontSize=9,  leading=12, textColor=PB_BLUE,  spaceAfter=4)
SUBTITLE  = style('Sub',      fontSize=11, leading=16, textColor=PB_GRAY,  spaceAfter=18)
H1        = style('H1',       fontName=FONT_BOLD, fontSize=16, leading=22, textColor=PB_NAVY,  spaceBefore=18, spaceAfter=10)
H2        = style('H2',       fontName=FONT_BOLD, fontSize=11, leading=16, textColor=PB_BLUE,  spaceBefore=10, spaceAfter=6)
BODY      = style('Body',     fontSize=10, leading=15)
BODY_SM   = style('BodySm',   fontSize=9,  leading=13, textColor=PB_GRAY)
BODY_TINY = style('BodyTiny', fontSize=8,  leading=11, textColor=PB_GRAY2)
NOTE      = style('Note',     fontSize=9,  leading=13)
CODE      = style('Code',     fontName='Courier', fontSize=8, leading=11)

def section_header(num, title_th, title_en=None):
    """Numbered colorful section header with kicker line."""
    label = f'<font color="#2563eb">SECTION {num}</font>'
    return [
        Spacer(1, 6),
        Paragraph(label, KICKER),
        Paragraph(title_th, H1),
        HRFlowable(width='100%', thickness=1.5, color=PB_BLUE, spaceBefore=0, spaceAfter=8),
    ]

def code_block(text):
    """Code in a soft gray box."""
    pre = Preformatted(text, CODE)
    tbl = Table([[pre]], colWidths=[165*mm])
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0),(-1,-1), PB_CODE_BG),
        ('BOX',        (0,0),(-1,-1), 0.5, PB_BORDER),
        ('LEFTPADDING',(0,0),(-1,-1), 10),
        ('RIGHTPADDING',(0,0),(-1,-1), 10),
        ('TOPPADDING', (0,0),(-1,-1), 8),
        ('BOTTOMPADDING',(0,0),(-1,-1), 8),
    ]))
    return tbl

def badge(text, fg, bg):
    """Inline colored badge — used in tables."""
    return Paragraph(
        f'<font color="#{fg.hexval()[2:]}"><b>{text}</b></font>',
        ParagraphStyle('badge', fontName=FONT_BOLD, fontSize=8, alignment=TA_CENTER,
                       backColor=bg, borderRadius=4, leading=12,
                       borderPadding=(2, 6, 2, 6)))

# ── Build doc ──
doc = SimpleDocTemplate(
    OUT, pagesize=A4,
    leftMargin=22*mm, rightMargin=22*mm,
    topMargin=22*mm, bottomMargin=20*mm,
    title='Proposal: tbl_user_credit_transaction',
    author='PetabyteAi',
)

# ── Page templates: add page numbers ──
def add_page_chrome(canvas, doc):
    canvas.saveState()
    canvas.setFont(FONT, 8)
    canvas.setFillColor(PB_GRAY2)
    canvas.drawString(22*mm, 12*mm, 'PetabyteAi  ·  Phase 21.5 proposal')
    canvas.drawRightString(A4[0] - 22*mm, 12*mm, f'page {doc.page}')
    canvas.setStrokeColor(PB_BORDER)
    canvas.setLineWidth(0.3)
    canvas.line(22*mm, 14*mm, A4[0] - 22*mm, 14*mm)
    canvas.restoreState()

story = []

# ═══════════ COVER ═══════════
story.append(Paragraph('DATABASE  DESIGN  PROPOSAL', KICKER))
story.append(Spacer(1, 4))
story.append(Paragraph('tbl_user_credit_transaction', TITLE))
story.append(Paragraph('Per-user credit movement journal · Phase 21.5', SUBTITLE))
story.append(HRFlowable(width='100%', thickness=3, color=PB_INDIGO, spaceBefore=0, spaceAfter=18))

# Executive summary box
exec_para = Paragraph(
    'ตารางใหม่สำหรับเก็บ <b>ประวัติทุกการเปลี่ยนแปลง credit ของ user</b> — '
    'ทั้งตอนได้รับเงิน (topup จาก admin) และตอนใช้เงิน (usage จาก chat). '
    'ทุก event มี balance_before / balance_after เพื่อ audit ครบ; '
    'รองรับทั้ง <b>Day view</b> และ <b>Month view</b> จาก mockup dashboard ของลูกค้า.',
    BODY)
sum_table = Table([[exec_para]], colWidths=[166*mm])
sum_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), PB_SOFT),
    ('BOX',        (0,0), (-1,-1), 0.5, PB_LINE),
    ('LINEABOVE',  (0,0), (-1,0), 3, PB_INDIGO),
    ('TOPPADDING', (0,0), (-1,-1), 14),
    ('BOTTOMPADDING',(0,0),(-1,-1), 14),
    ('LEFTPADDING',(0,0), (-1,-1), 18),
    ('RIGHTPADDING',(0,0),(-1,-1), 18),
]))
story.append(sum_table)
story.append(Spacer(1, 16))

# Quick facts (compact)
facts = Table([
    ['Table name',  'tbl_user_credit_transaction',  'Type',       '1 table + 1 view'],
    ['Risk',        'Low (additive only)',           'Rollback',   'DROP TABLE — data ไม่เสีย'],
    ['Migration',   'phase21-005 + phase21-006',     'Code edits', '2 จุดใน server.js'],
], colWidths=[28*mm, 56*mm, 28*mm, 54*mm])
facts.setStyle(TableStyle([
    ('FONT',       (0,0), (-1,-1), FONT, 9),
    ('FONT',       (0,0), (0,-1),  FONT_BOLD, 9),
    ('FONT',       (2,0), (2,-1),  FONT_BOLD, 9),
    ('TEXTCOLOR',  (0,0), (0,-1),  PB_GRAY),
    ('TEXTCOLOR',  (2,0), (2,-1),  PB_GRAY),
    ('TEXTCOLOR',  (1,0), (1,-1),  PB_NAVY),
    ('TEXTCOLOR',  (3,0), (3,-1),  PB_NAVY),
    ('VALIGN',     (0,0), (-1,-1), 'MIDDLE'),
    ('LINEBELOW',  (0,0), (-1,-2), 0.3, PB_BORDER),
    ('TOPPADDING', (0,0), (-1,-1), 7),
    ('BOTTOMPADDING',(0,0), (-1,-1), 7),
]))
story.append(facts)

# ═══════════ 1. WHY ═══════════
story.extend(section_header('01', 'ทำไมต้องสร้าง table นี้'))
story.append(Paragraph(
    'จาก mockup dashboard ที่ลูกค้าออกแบบ ต้องการดู <b>"history per user"</b> '
    'ว่าใคร <b>ได้รับ credit</b> มาเท่าไหร่ และ <b>ใช้ไป</b> เท่าไหร่ ในช่วงเวลาที่เลือก '
    '(ดูทั้งแบบรายวัน + รายเดือน). ตอนนี้ระบบเรามีข้อมูลครบบ้างขาดบ้าง:',
    BODY))

story.append(Spacer(1, 6))
gap_data = [
    ['Topup',  '✓ admin → project pool',  '✗ admin → user (ขาด!)'],
    ['Usage',  '✓ tbl_response (chat)',   '✓ มีครบ'],
    ['Audit',  '⚠ ปนใน tbl_action_admin', '⚠ query ยาก (JSONB)'],
]
gap_data.insert(0, ['', 'มีในระบบแล้ว', 'สิ่งที่ขาด'])
gap = Table(gap_data, colWidths=[30*mm, 67*mm, 67*mm])
gap.setStyle(TableStyle([
    ('FONT',       (0,0), (-1,0),  FONT_BOLD, 9),
    ('FONT',       (0,1), (-1,-1), FONT, 9),
    ('FONT',       (0,1), (0,-1),  FONT_BOLD, 9),
    ('BACKGROUND', (0,0), (-1,0),  PB_NAVY),
    ('TEXTCOLOR',  (0,0), (-1,0),  white),
    ('TEXTCOLOR',  (0,1), (0,-1),  PB_INDIGO),
    ('TEXTCOLOR',  (2,1), (2,1),   PB_RED),    # missing topup
    ('BACKGROUND', (2,1), (2,1),   PB_RED_BG),
    ('GRID',       (0,0), (-1,-1), 0.3, PB_BORDER),
    ('VALIGN',     (0,0), (-1,-1), 'MIDDLE'),
    ('TOPPADDING', (0,0), (-1,-1), 7),
    ('BOTTOMPADDING',(0,0), (-1,-1), 7),
]))
story.append(gap)
story.append(Spacer(1, 6))
story.append(Paragraph(
    'ปัญหาหลัก: <b>"admin จัดสรร pool → user"</b> ไม่มีการบันทึกเป็น transaction '
    '— ตอนนี้แค่เห็นใน audit log ปนกับ action อื่นๆ. dashboard ที่ลูกค้าออกแบบจะ query ยากมาก.',
    BODY))

# ═══════════ 2. SCHEMA EXPLAINED ═══════════
story.append(PageBreak())
story.extend(section_header('02', 'อธิบาย Schema ทีละ column'))
story.append(Paragraph(
    'ตารางนี้เก็บ <b>1 row ต่อ 1 transaction</b> (ทุก credit movement = 1 row). '
    'ไม่มีการ aggregate ใน table — Day/Month view ทำที่ query level.',
    BODY))

cols = [
    ['transaction_id', 'BIGSERIAL', 'auto', 'PK — รัน serial', '1, 2, 3, ...'],
    ['user_id',        'INT',       'NOT NULL', 'FK → tbl_user — user คนไหน', '2 (user)'],
    ['project_id',     'VARCHAR(100)', 'NULL', 'FK → tbl_project — context', 'proj_abap'],

    ['transaction_type', 'VARCHAR(20)', 'NOT NULL',
     'ประเภท transaction (4 ค่า — ใช้ 2 อันแรกก่อน, อีก 2 สำรอง)',
     "topup / usage"],

    ['amount',         'DECIMAL(12,4)', 'NOT NULL',
     'จำนวนเงิน <b>มีเครื่องหมาย</b> (+ = ได้รับ, - = ใช้)',
     '+50.00 / -0.88'],

    ['balance_before', 'DECIMAL(12,4)', 'NULL',
     'ยอดก่อน transaction (snapshot ตอน insert)',
     '100.00'],

    ['balance_after',  'DECIMAL(12,4)', 'NULL',
     'ยอดหลัง transaction (= before + amount)',
     '99.12'],

    ['ref_type',       'VARCHAR(20)',   'NULL',
     'มาจากการกระทำอะไร — chat / admin_edit / admin_topup',
     'chat'],

    ['ref_id',         'BIGINT',        'NULL',
     'id ของต้นทาง (session_id / action_id) — สำหรับ trace กลับ',
     '42 (session)'],

    ['note',           'TEXT',          'NULL',
     'admin จดบันทึกได้ (เช่น "เติมตามใบ PR2025-001")',
     '"top-up Q4"'],

    ['created_by',     'INT',           'NULL',
     'admin user_id ที่ทำ (NULL = auto จาก chat)',
     '1 (admin)'],

    ['created_at',     'TIMESTAMPTZ',   'NOW()',
     'เวลาที่เกิด transaction — ใช้ filter Day/Month',
     '2025-10-28 14:22'],
]
header = ['Column', 'Type', 'Required', 'หน้าที่', 'ตัวอย่าง']
data = [header]
for r in cols:
    data.append([
        Paragraph(f'<font name="Courier" color="#2563eb"><b>{r[0]}</b></font>', BODY_SM),
        Paragraph(f'<font name="Courier" size="8">{r[1]}</font>', BODY_SM),
        Paragraph(r[2], BODY_TINY),
        Paragraph(r[3], BODY_SM),
        Paragraph(f'<font name="Courier" size="8">{r[4]}</font>', BODY_SM),
    ])

col_tbl = Table(data, colWidths=[34*mm, 25*mm, 17*mm, 60*mm, 30*mm], repeatRows=1)
col_tbl.setStyle(TableStyle([
    ('FONT',       (0,0), (-1,0),  FONT_BOLD, 9),
    ('BACKGROUND', (0,0), (-1,0),  PB_NAVY),
    ('TEXTCOLOR',  (0,0), (-1,0),  white),
    ('ALIGN',      (0,0), (-1,0),  'LEFT'),
    ('VALIGN',     (0,0), (-1,-1), 'TOP'),
    ('GRID',       (0,0), (-1,-1), 0.3, PB_BORDER),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [white, PB_LIGHT]),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING',(0,0), (-1,-1), 5),
    ('LEFTPADDING',(0,0), (-1,-1), 5),
    ('RIGHTPADDING',(0,0), (-1,-1), 5),
]))
story.append(Spacer(1, 8))
story.append(col_tbl)

story.append(Spacer(1, 12))
story.append(Paragraph('Indexes ที่สร้างให้', H2))
story.append(Paragraph(
    'เพื่อให้ query Day view + Month view + filter ตาม user/project ทำงานเร็ว:',
    BODY_SM))
idx_data = [
    ['idx_uct_user_date',     '(user_id, created_at DESC)',     '"user คนนี้ดูประวัติย้อน"'],
    ['idx_uct_project_date',  '(project_id, created_at DESC)',  '"project นี้สรุป transaction"'],
    ['idx_uct_date',          '(created_at DESC)',              '"ทุก transaction วันนี้"'],
    ['idx_uct_type_date',     '(transaction_type, created_at)', '"แค่ topup / แค่ usage"'],
]
idx_tbl = Table([['ชื่อ index', 'Columns', 'ใช้สำหรับ']] + idx_data,
                colWidths=[42*mm, 60*mm, 64*mm])
idx_tbl.setStyle(TableStyle([
    ('FONT',       (0,0), (-1,0),  FONT_BOLD, 9),
    ('FONT',       (0,1), (-1,-1), FONT, 9),
    ('FONT',       (0,1), (1,-1),  'Courier', 8),
    ('BACKGROUND', (0,0), (-1,0),  PB_BLUE),
    ('TEXTCOLOR',  (0,0), (-1,0),  white),
    ('GRID',       (0,0), (-1,-1), 0.3, PB_BORDER),
    ('TOPPADDING', (0,0), (-1,-1), 6),
    ('BOTTOMPADDING',(0,0), (-1,-1), 6),
]))
story.append(idx_tbl)

# ═══════════ 3. TRANSACTION TYPES ═══════════
story.append(PageBreak())
story.extend(section_header('03', 'Transaction Types — 4 ประเภท'))
story.append(Paragraph(
    'Column <b>transaction_type</b> มี 4 ค่าที่กำหนดไว้ — เริ่มใช้ <b>2 อันแรก</b> ก่อน '
    '(topup + usage) อีก 2 อันสำรองไว้รองรับ feature ในอนาคต (refund, admin adjustment) '
    'โดยไม่ต้องเปลี่ยน schema.',
    BODY))

types_data = [
    ['topup',
     '+',
     'admin เติม credit ให้ user คนนี้',
     'Admin ใส่ 100 ใน Edit User → +100',
     'YES'],
    ['usage',
     '-',
     'user ใช้ chat — หัก credit ตาม cost',
     'User chat 1 turn cost ฿0.88 → -0.88',
     'YES'],
    ['adjustment',
     '±',
     'admin แก้ตรงๆ (เช่น โอน, แก้ข้อผิดพลาด)',
     'Admin ปรับลด credit ที่เติมผิด → -10',
     'รอใช้'],
    ['refund',
     '+',
     'คืน credit (เช่น chat fail, complaint)',
     'User chat error ระบบ → คืน +0.88',
     'รอใช้'],
]
type_rows = [['Type', 'Sign', 'ความหมาย', 'ตัวอย่าง', 'Active?']]
for t in types_data:
    type_rows.append([
        Paragraph(f'<font name="Courier" color="#2563eb"><b>{t[0]}</b></font>', BODY),
        Paragraph(
            f'<font color="{"#16a34a" if t[1] == "+" else ("#dc2626" if t[1] == "-" else "#d97706")}" size="12"><b>{t[1]}</b></font>',
            BODY),
        Paragraph(t[2], BODY_SM),
        Paragraph(t[3], BODY_SM),
        Paragraph(
            f'<font color="{"#16a34a" if t[4] == "YES" else "#94a3b8"}"><b>{t[4]}</b></font>',
            BODY_SM),
    ])
type_tbl = Table(type_rows, colWidths=[24*mm, 12*mm, 50*mm, 60*mm, 20*mm], repeatRows=1)
type_tbl.setStyle(TableStyle([
    ('FONT',       (0,0), (-1,0),  FONT_BOLD, 9),
    ('BACKGROUND', (0,0), (-1,0),  PB_NAVY),
    ('TEXTCOLOR',  (0,0), (-1,0),  white),
    ('ALIGN',      (1,0), (1,-1),  'CENTER'),
    ('ALIGN',      (4,0), (4,-1),  'CENTER'),
    ('VALIGN',     (0,0), (-1,-1), 'MIDDLE'),
    ('GRID',       (0,0), (-1,-1), 0.3, PB_BORDER),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [white, PB_LIGHT]),
    ('TOPPADDING', (0,0), (-1,-1), 8),
    ('BOTTOMPADDING',(0,0), (-1,-1), 8),
]))
story.append(Spacer(1, 8))
story.append(type_tbl)

# ═══════════ 4. REAL EXAMPLE FLOW ═══════════
story.append(Spacer(1, 18))
story.extend(section_header('04', 'ตัวอย่างจริง — Flow + rows ใน table'))
story.append(Paragraph(
    'สมมติ user คนหนึ่งใช้งานในรอบ 4 วัน — มาดูว่า rows ใน table จะหน้าตาเป็นแบบไหน:',
    BODY))

story.append(Spacer(1, 8))
flow_steps = [
    ['1', '25/10  09:00', 'Admin Somchai เติม 100 บาท ให้ user',
     'INSERT topup +100', '+100.00'],
    ['2', '26/10  14:30', 'User chat 1 turn (cost 0.88)',
     'INSERT usage -0.88', '99.12'],
    ['3', '27/10  10:15', 'User chat อีก 1 turn (cost 1.20)',
     'INSERT usage -1.20', '97.92'],
    ['4', '28/10  16:00', 'Admin เติมเพิ่มอีก 50 บาท',
     'INSERT topup +50',  '147.92'],
]
flow_rows = [['#', 'When', 'What happened', 'DB action', 'Balance after']]
for r in flow_steps:
    flow_rows.append(r)
flow_tbl = Table(flow_rows, colWidths=[8*mm, 26*mm, 60*mm, 38*mm, 30*mm], repeatRows=1)
flow_tbl.setStyle(TableStyle([
    ('FONT',       (0,0), (-1,0),  FONT_BOLD, 9),
    ('FONT',       (0,1), (-1,-1), FONT, 8),
    ('FONT',       (3,1), (3,-1),  'Courier', 8),
    ('FONT',       (4,1), (4,-1),  'Courier', 8),
    ('FONT',       (1,1), (1,-1),  'Courier', 8),
    ('BACKGROUND', (0,0), (-1,0),  PB_BLUE),
    ('TEXTCOLOR',  (0,0), (-1,0),  white),
    ('TEXTCOLOR',  (4,1), (4,-1),  PB_NAVY),
    ('ALIGN',      (0,0), (0,-1),  'CENTER'),
    ('ALIGN',      (4,0), (4,-1),  'RIGHT'),
    ('VALIGN',     (0,0), (-1,-1), 'MIDDLE'),
    ('GRID',       (0,0), (-1,-1), 0.3, PB_BORDER),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [white, PB_LIGHT]),
    ('TOPPADDING', (0,0), (-1,-1), 6),
    ('BOTTOMPADDING',(0,0), (-1,-1), 6),
]))
story.append(flow_tbl)

# Resulting rows
story.append(Spacer(1, 12))
story.append(Paragraph('→ ใน tbl_user_credit_transaction จะมี 4 rows แบบนี้:', H2))
sample_rows = [
    ['id', 'type',   'amount',  'before', 'after',  'ref',          'created_at'],
    ['1',  'topup',  '+100.00', '0.00',   '100.00', 'admin_edit#A1','2025-10-25 09:00'],
    ['2',  'usage',  '-0.88',   '100.00', '99.12',  'chat#42',      '2025-10-26 14:30'],
    ['3',  'usage',  '-1.20',   '99.12',  '97.92',  'chat#42',      '2025-10-27 10:15'],
    ['4',  'topup',  '+50.00',  '97.92',  '147.92', 'admin_edit#A2','2025-10-28 16:00'],
]
samp = Table(sample_rows, colWidths=[10*mm, 22*mm, 22*mm, 22*mm, 22*mm, 30*mm, 36*mm])
samp.setStyle(TableStyle([
    ('FONT',       (0,0), (-1,0),  FONT_BOLD, 8),
    ('FONT',       (0,1), (-1,-1), 'Courier', 8),
    ('BACKGROUND', (0,0), (-1,0),  PB_INDIGO),
    ('TEXTCOLOR',  (0,0), (-1,0),  white),
    ('TEXTCOLOR',  (2,1), (2,1),   PB_GREEN),  ('BACKGROUND', (2,1), (2,1), PB_GREEN_BG),
    ('TEXTCOLOR',  (2,2), (2,3),   PB_RED),    ('BACKGROUND', (2,2), (2,3), PB_RED_BG),
    ('TEXTCOLOR',  (2,4), (2,4),   PB_GREEN),  ('BACKGROUND', (2,4), (2,4), PB_GREEN_BG),
    ('ALIGN',      (2,1), (4,-1),  'RIGHT'),
    ('GRID',       (0,0), (-1,-1), 0.3, PB_BORDER),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING',(0,0), (-1,-1), 5),
]))
story.append(samp)

# ═══════════ 5. DASHBOARD QUERIES ═══════════
story.append(PageBreak())
story.extend(section_header('05', 'ใช้ query ยังไง — Day vs Month view'))
story.append(Paragraph(
    'จุดเด่นของ design นี้คือ <b>table เดียวรองรับทั้ง 2 views</b> — '
    'ต่างกันแค่ <b>การ aggregate</b>:',
    BODY))

# Day query
story.append(Spacer(1, 8))
story.append(Paragraph('Day view  →  ดูทุก transaction แยกแถว', H2))
qday = '''SELECT created_at::date AS date,
       u.username,
       t.transaction_type AS type,
       ABS(t.amount)      AS amount
FROM tbl_user_credit_transaction t
JOIN tbl_user u USING (user_id)
WHERE created_at::date BETWEEN '2025-10-25' AND '2025-10-28'
ORDER BY created_at DESC;'''
story.append(code_block(qday))
story.append(Paragraph('→ ได้ผลลัพธ์ตรงกับรูป "Day view" ของลูกค้า', BODY_SM))

# Month query
story.append(Spacer(1, 10))
story.append(Paragraph('Month view  →  รวมตามเดือน + user + type', H2))
qmon = '''SELECT TO_CHAR(date_trunc('month', created_at), 'FMMonth YYYY') AS month,
       u.username,
       t.transaction_type AS type,
       SUM(ABS(t.amount))::numeric(12,2) AS total
FROM tbl_user_credit_transaction t
JOIN tbl_user u USING (user_id)
WHERE created_at >= '2025-10-01' AND created_at < '2025-12-01'
GROUP BY date_trunc('month', created_at), u.username, t.transaction_type
ORDER BY 1, total DESC;'''
story.append(code_block(qmon))
story.append(Paragraph('→ ได้ผลลัพธ์ตรงกับรูป "Month view" ของลูกค้า', BODY_SM))

# ═══════════ 6. CODE TOUCHES ═══════════
story.append(Spacer(1, 18))
story.extend(section_header('06', 'Code ที่ต้องแก้ — แค่ 2 จุด'))

# Diagram of changes
story.append(Paragraph('Chat handler  +  Admin edit user  =  2 จุด INSERT', H2))
story.append(Paragraph(
    'ทุกที่อื่นในระบบไม่ต้องแตะ — schema ที่มีอยู่ไม่เปลี่ยน, '
    'การคำนวณ cost / pricing / daily_usage ทำงานเหมือนเดิม.',
    BODY_SM))

story.append(Spacer(1, 6))
story.append(Paragraph('① Chat handler — หลัง deduct credit', H2))
code1 = '''// (server.js · ใน /api/chat หลัง UPDATE tbl_credits)
await pool.query(`
    INSERT INTO tbl_user_credit_transaction
        (user_id, project_id, transaction_type, amount,
         balance_before, balance_after, ref_type, ref_id, created_by)
    VALUES ($1, $2, 'usage', $3, $4, $5, 'chat', $6, NULL)
`, [userId, projectId, -cost, balBefore, balAfter, chatSessionId]);'''
story.append(code_block(code1))

story.append(Spacer(1, 8))
story.append(Paragraph('② Admin edit user — เมื่อ balance เปลี่ยน', H2))
code2 = '''// (server.js · ใน PUT /api/users/:id เมื่อมี balance ใน body)
const delta = balanceNum - prevBalance;
if (delta !== 0) {
    const txType = delta > 0 ? 'topup' : 'adjustment';
    await pool.query(`
        INSERT INTO tbl_user_credit_transaction
            (user_id, project_id, transaction_type, amount,
             balance_before, balance_after, ref_type, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, 'admin_edit', $7)
    `, [userId, projectId, txType, delta, prevBalance, balanceNum,
        req.session.userId]);
}'''
story.append(code_block(code2))

# ═══════════ 7. APPROVAL ═══════════
story.append(PageBreak())
story.extend(section_header('07', 'รายการที่ต้อง approve'))
story.append(Paragraph(
    'ก่อน implement ขอ confirm 8 ข้อนี้ — ถ้า OK ทั้งหมด ผมเริ่มสร้าง migration ได้เลย. '
    'ถ้าอยากปรับข้อใด ระบุเลข item + รายละเอียดใหม่ที่ต้องการ.',
    BODY))

approval = [
    ['#', 'ประเด็น', 'ที่ตั้งใจ', 'OK?'],
    ['1', 'ชื่อ table', 'tbl_user_credit_transaction', '☐'],
    ['2', 'Transaction types', '4 ค่า — topup, usage (active) + adjustment, refund (reserve)', '☐'],
    ['3', 'Amount sign', 'Signed — + = inflow, − = outflow', '☐'],
    ['4', 'Backfill historic', 'YES — usage จาก tbl_response, topup จาก audit log', '☐'],
    ['5', 'balance_before/after (historic)', 'ปล่อย NULL ได้ (reconstruct ไม่ได้)', '☐'],
    ['6', 'Code changes', '2 จุด — chat handler + admin edit user', '☐'],
    ['7', 'VIEW v_user_credit_transaction', 'สร้างเลย (JOIN user + project, friendly columns)', '☐'],
    ['8', 'UI Dashboard', 'ยังไม่ทำในรอบนี้ — แค่ schema + backend', '☐'],
]
appr_para = [
    [Paragraph(r[0], BODY), Paragraph(r[1], BODY), Paragraph(r[2], BODY_SM), Paragraph(r[3], BODY)]
    if i > 0 else r
    for i, r in enumerate(approval)
]
ap_tbl = Table(appr_para, colWidths=[10*mm, 56*mm, 86*mm, 14*mm])
ap_tbl.setStyle(TableStyle([
    ('FONT',       (0,0), (-1,0),  FONT_BOLD, 9),
    ('BACKGROUND', (0,0), (-1,0),  PB_NAVY),
    ('TEXTCOLOR',  (0,0), (-1,0),  white),
    ('ALIGN',      (0,0), (0,-1),  'CENTER'),
    ('ALIGN',      (3,0), (3,-1),  'CENTER'),
    ('VALIGN',     (0,0), (-1,-1), 'MIDDLE'),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [white, PB_LIGHT]),
    ('GRID',       (0,0), (-1,-1), 0.3, PB_BORDER),
    ('TOPPADDING', (0,0), (-1,-1), 9),
    ('BOTTOMPADDING',(0,0), (-1,-1), 9),
    ('LEFTPADDING',(0,0), (-1,-1), 8),
    ('RIGHTPADDING',(0,0), (-1,-1), 8),
]))
story.append(ap_tbl)

# Final note
story.append(Spacer(1, 22))
final_note = Paragraph(
    '<b>ตอบกลับ "ลุย"</b> หรือ <b>"approve"</b> เพื่อเริ่ม implement.<br/>'
    'ถ้ามีข้อที่ต้องการเปลี่ยน ระบุ <b>เลข item + ค่าใหม่</b> ผมจะ update proposal ก่อน apply.',
    NOTE)
note_wrap = Table([[final_note]], colWidths=[166*mm])
note_wrap.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), PB_AMBER_BG),
    ('BOX',        (0,0), (-1,-1), 0.5, PB_AMBER),
    ('LINEABOVE',  (0,0), (-1,0),  3,   PB_AMBER),
    ('TOPPADDING', (0,0), (-1,-1), 14),
    ('BOTTOMPADDING',(0,0), (-1,-1), 14),
    ('LEFTPADDING',(0,0), (-1,-1), 18),
    ('RIGHTPADDING',(0,0), (-1,-1), 18),
]))
story.append(note_wrap)

# Build
doc.build(story, onFirstPage=add_page_chrome, onLaterPages=add_page_chrome)
print('done:', OUT, '-', os.path.getsize(OUT), 'bytes')
