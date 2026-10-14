// NyaySaathi - AI-Powered Legal Companion Application
// Main JavaScript file for handling all interactions and functionality

// Application State Management (In-memory storage)
const AppState = {
  currentUser: null,
  currentPage: 'dashboard',
  chatMessages: [],
  intakeProgress: {
    step: 0,
    ageRange: null,
    category: null,
    description: null,
    completion: 0
  },
  caseData: {
    id: 'NS-2025-001',
    risk_level: 'Medium',
    urgency: 'High',
    domain: 'Workplace Harassment',
    status: 'Triage Complete',
    completion: 75,
    created: '2025-10-20'
  },
  documents: [],
  lawyerAssignments: [],
  settings: {
    theme: 'light',
    language: 'en',
    fontSize: 14
  },
  piiRedacted: false,
  sidebarCollapsed: false,
  isNarrow: null,
  activeCaseTab: 'overview',
  marketplaceQuery: '',
  recognition: null,
  piiRedacted: false,
  fabExpanded: false,
  aiAssistantOpen: false,
  widgets: {
    'case-status': { visible: true, position: 1 },
    'next-steps': { visible: true, position: 2 },
    'documents': { visible: true, position: 3 },
    'lawyer-response': { visible: true, position: 4 },
    'risk-assessment': { visible: true, position: 5 },
    'topic-heatmap': { visible: true, position: 6 }
  }
};

// Persistence (localStorage) ----------------------------------------------
const STORAGE_KEY = 'nyaysaathi:state:v1';

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      currentUser: AppState.currentUser,
      currentPage: AppState.currentPage,
      caseData: AppState.caseData,
      intakeProgress: AppState.intakeProgress,
      documents: AppState.documents,
      lawyerAssignments: AppState.lawyerAssignments,
      settings: AppState.settings,
      widgets: AppState.widgets,
      sidebarCollapsed: AppState.sidebarCollapsed
    }));
    return true;
  } catch (error) {
    // Private browsing / quota errors must never break the UI.
    console.warn('NyaySaathi: state could not be saved', error);
    return false;
  }
}

function restoreState() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch (error) {
    console.warn('NyaySaathi: saved state was unreadable, starting fresh', error);
    return false;
  }
  if (!saved) return false;

  Object.assign(AppState, {
    currentUser: saved.currentUser || null,
    caseData: Object.assign({}, AppState.caseData, saved.caseData),
    intakeProgress: Object.assign({}, AppState.intakeProgress, saved.intakeProgress),
    documents: Array.isArray(saved.documents) ? saved.documents : [],
    lawyerAssignments: Array.isArray(saved.lawyerAssignments) ? saved.lawyerAssignments : [],
    settings: Object.assign({}, AppState.settings, saved.settings),
    sidebarCollapsed: !!saved.sidebarCollapsed,
    widgets: Object.assign({}, AppState.widgets, saved.widgets)
  });
  return true;
}

function clearPersistedState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('NyaySaathi: could not clear saved state', error);
  }
}

// Safe DOM helpers ----------------------------------------------------------
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

// Minimal, standards-valid PDF writer. Produces a one-page PDF per entry so
// that "download" actions hand back a file that actually opens.
function buildSimplePdf(title, lines) {
  const esc = text => String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const body = [];
  body.push('BT /F1 16 Tf 56 780 Td (' + esc(title) + ') Tj ET');
  lines.slice(0, 55).forEach((line, index) => {
    body.push('BT /F1 10 Tf 56 ' + (750 - index * 15) + ' Td (' + esc(line) + ') Tj ET');
  });

  const content = body.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  });

  const xrefOffset = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  offsets.forEach(offset => {
    pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
  });
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF';
  return pdf;
}

function downloadFile(filename, content, mimeType) {
  const type = mimeType || 'text/plain;charset=utf-8';
  let url;
  let revoke = () => {};

  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
    url = URL.createObjectURL(new Blob([content], { type }));
    revoke = () => URL.revokeObjectURL(url);
  } else {
    // Fallback for engines without object URLs (tests, hardened embeds).
    url = `data:${type};base64,${btoa(unescape(encodeURIComponent(content)))}`;
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(revoke, 1000);
  return { filename, bytes: content.length };
}

// Legal knowledge base: maps an intake category to the guidance the rest of the
// app consumes (risk factors, statutes, evidence, matching lawyer specialities).
const LegalKnowledge = {
  Workplace: {
    domain: 'Workplace Harassment',
    statutes: [
      { id: 'posh-act', name: 'POSH Act 2013', description: 'Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act', lastUpdated: '2024-09-01' },
      { id: 'ipc-354a', name: 'IPC Section 354A', description: 'Sexual harassment and punishment for sexual harassment', lastUpdated: '2024-08-15' }
    ],
    evidence: ['Email correspondence', 'Witness statements', 'Incident log', 'Company policies'],
    documents: ['Email correspondence', 'Witness statements', 'Incident timeline', 'Employment contract'],
    goals: [
      { icon: 'fa-shield-alt', text: 'Immediate protection from harassment' },
      { icon: 'fa-gavel', text: 'Formal disciplinary action against perpetrator' },
      { icon: 'fa-coins', text: 'Compensation for mental harassment' },
      { icon: 'fa-clipboard-check', text: 'Workplace policy improvements' }
    ],
    story: {
      title: 'A Similar Situation',
      summary: 'Ramesh faced repeated inappropriate comments from his supervisor. He documented incidents over 3 months, including emails and two witness statements.',
      timeline: [
        { phase: 'Month 1-3: Documentation', text: 'Collected emails, witness statements, recorded incidents with dates' },
        { phase: 'Month 4: Formal Complaint', text: 'Filed a written complaint with the Internal Committee under the POSH Act' },
        { phase: 'Month 6: Resolution', text: 'Committee found the allegations substantiated; disciplinary action followed' }
      ],
      outcomes: [
        { type: 'success', title: 'Favorable', description: 'Compensation awarded, disciplinary action taken', timeline: '6 months' },
        { type: 'warning', title: 'Mixed', description: 'Partial resolution, workplace changes implemented', timeline: '4-8 months' },
        { type: 'error', title: 'Challenging', description: 'Insufficient evidence, complaint not substantiated', timeline: '2-4 months' }
      ]
    },
    recommendedForum: 'Internal Committee of your establishment (or the Local Committee where no IC exists)',
    lawyerSpecialities: ['Workplace Issues', 'Criminal Law'],
    baseRisk: 52
  },
  Family: {
    domain: 'Family & Domestic Matters',
    statutes: [
      { id: 'dva-2005', name: 'Domestic Violence Act 2005', description: 'Protection of Women from Domestic Violence Act — residence orders, protection orders, monetary relief', lastUpdated: '2024-07-20' },
      { id: 'ipc-498a', name: 'IPC Section 498A', description: 'Husband or relative of husband subjecting a woman to cruelty', lastUpdated: '2024-08-15' }
    ],
    evidence: ['Medical records', 'Communications', 'Photographs', 'Neighbour statements'],
    documents: ['Marriage certificate', 'Medical records', 'Communication records', 'Address proof'],
    goals: [
      { icon: 'fa-shield-alt', text: 'Protection order and safe accommodation' },
      { icon: 'fa-house', text: 'Right to reside in the shared household' },
      { icon: 'fa-coins', text: 'Maintenance and monetary relief' },
      { icon: 'fa-child', text: 'Child custody and visitation arrangement' }
    ],
    story: {
      title: 'A Similar Situation',
      summary: 'Anita left her marital home after repeated verbal and physical abuse. She first approached a protection officer and secured an interim residence order.',
      timeline: [
        { phase: 'Week 1: Protection Officer', text: 'Domestic Incident Report recorded; interim protection order sought' },
        { phase: 'Month 2: Interim Orders', text: 'Residence and monetary relief orders granted; counselling directed' },
        { phase: 'Month 9: Final Order', text: 'Permanent protection, custody arrangement and maintenance settled' }
      ],
      outcomes: [
        { type: 'success', title: 'Favorable', description: 'Protection, residence and maintenance orders granted', timeline: '6-12 months' },
        { type: 'warning', title: 'Mixed', description: 'Protection granted; maintenance contested and delayed', timeline: '12-18 months' },
        { type: 'error', title: 'Challenging', description: 'Orders delayed for lack of contemporaneous records', timeline: '18+ months' }
      ]
    },
    recommendedForum: 'Judicial Magistrate for protection and residence orders under the DV Act',
    lawyerSpecialities: ['Family Law', 'Domestic Violence', 'Divorce'],
    baseRisk: 58
  },
  Consumer: {
    domain: 'Consumer Dispute',
    statutes: [
      { id: 'cpa-2019', name: 'Consumer Protection Act 2019', description: 'Consumer rights, product liability, e-commerce rules and mediation', lastUpdated: '2024-10-10' }
    ],
    evidence: ['Invoices and receipts', 'Order and warranty records', 'Written complaints', 'Photographs of defect'],
    documents: ['Purchase invoice', 'Warranty card', 'Written complaint reply', 'Photographs of the defect'],
    goals: [
      { icon: 'fa-undo', text: 'Refund or replacement of the defective goods' },
      { icon: 'fa-coins', text: 'Compensation for loss and mental agony' },
      { icon: 'fa-file-signature', text: 'Formal notice to the seller or service provider' }
    ],
    story: {
      title: 'A Similar Situation',
      summary: 'Kabir paid in full for a washing machine that never worked and received no response from the seller for two months.',
      timeline: [
        { phase: 'Day 1-30: Written Complaint', text: 'Noticed the seller in writing and kept the acknowledgement' },
        { phase: 'Month 2: Legal Notice', text: 'Notice seeking refund and compensation; no reply received' },
        { phase: 'Month 4: District Commission', text: 'E-filing accepted; refund with interest granted at first hearing stage' }
      ],
      outcomes: [
        { type: 'success', title: 'Favorable', description: 'Full refund plus compensation and costs', timeline: '3-6 months' },
        { type: 'warning', title: 'Mixed', description: 'Replacement ordered, compensation refused', timeline: '6-10 months' },
        { type: 'error', title: 'Challenging', description: 'Claim rejected for missing proof of payment', timeline: '2-4 months' }
      ]
    },
    recommendedForum: 'District Consumer Disputes Redressal Commission — e-filing is available',
    lawyerSpecialities: ['Consumer Rights', 'Civil Matters'],
    baseRisk: 28
  },
  Property: {
    domain: 'Property Dispute',
    statutes: [
      { id: 'rta-2016', name: 'Real Estate (Regulation and Development) Act 2016', description: 'Registration of projects and promoter obligations', lastUpdated: '2024-06-11' },
      { id: 'tpa-1882', name: 'Transfer of Property Act 1882', description: 'Transfer, sale, lease and mortgage of immovable property', lastUpdated: '2024-05-02' }
    ],
    evidence: ['Title documents', 'Registration records', 'Payment receipts', 'Survey or mutation records'],
    documents: ['Sale deed / title deed', 'Encumbrance certificate', 'Payment receipts', 'Property tax receipts'],
    goals: [
      { icon: 'fa-file-contract', text: 'Establish clear and marketable title' },
      { icon: 'fa-gavel', text: 'Possession or specific performance of the agreement' },
      { icon: 'fa-coins', text: 'Refund with interest where delivery failed' }
    ],
    story: {
      title: 'A Similar Situation',
      summary: 'Meera paid 60% of the consideration for a flat, but registration was repeatedly delayed by the builder.',
      timeline: [
        { phase: 'Month 1: Title Search', text: 'Encumbrance certificate and RERA registration status verified' },
        { phase: 'Month 3: Notice & RERA Complaint', text: 'Notice served; RERA complaint filed for delayed possession' },
        { phase: 'Month 11: Order', text: 'Possession with interest for delay, or refund with interest' }
      ],
      outcomes: [
        { type: 'success', title: 'Favorable', description: 'Possession ordered with interest for the delay', timeline: '9-14 months' },
        { type: 'warning', title: 'Mixed', description: 'Refund allowed in instalments', timeline: '14-24 months' },
        { type: 'error', title: 'Challenging', description: 'Dispute moved to civil suit; longer timeline', timeline: '24+ months' }
      ]
    },
    recommendedForum: 'RERA authority for registered projects; civil court otherwise',
    lawyerSpecialities: ['Property Law', 'Civil Matters'],
    baseRisk: 34
  },
  Criminal: {
    domain: 'Criminal Matter',
    statutes: [
      { id: 'bns-2023', name: 'Bharatiya Nyaya Sanhita 2023', description: 'Replaced the IPC — offences and penalties (applies to offences after 1 July 2024)', lastUpdated: '2024-10-01' },
      { id: 'crpc-1973', name: 'CrPC 1973 / BNSS 2023', description: 'Investigation, FIR, bail and trial procedure', lastUpdated: '2024-10-01' }
    ],
    evidence: ['FIR copy', 'Medical or forensic reports', 'Witness details', 'CCTV or digital evidence'],
    documents: ['FIR copy', 'Court orders received', 'Medical or forensic reports', 'Identity proof'],
    goals: [
      { icon: 'fa-balance-scale', text: 'Anticipatory or regular bail where applicable' },
      { icon: 'fa-file-alt', text: 'Discharge or quashing of the complaint' },
      { icon: 'fa-shield-alt', text: 'Protection of evidence and witness safety' }
    ],
    story: {
      title: 'A Similar Situation',
      summary: 'Faiz was named in a complaint at the local police station and sought anticipatory bail before any arrest.',
      timeline: [
        { phase: 'Day 0: FIR Copy', text: 'Obtained the FIR and preserved all communication with the investigating officer' },
        { phase: 'Week 1: Anticipatory Bail', text: 'Application moved before the Sessions Court with supporting documents' },
        { phase: 'Month 2: Discharge Stage', text: 'Direction against arrest granted during investigation' }
      ],
      outcomes: [
        { type: 'success', title: 'Favorable', description: 'Protection against arrest; matter ends at discharge', timeline: '2-5 months' },
        { type: 'warning', title: 'Mixed', description: 'Bail granted with conditions; trial continues', timeline: '12+ months' },
        { type: 'error', title: 'Challenging', description: 'Arrest before application; remand sought', timeline: '3-9 months' }
      ]
    },
    recommendedForum: 'Sessions Court for anticipatory bail, discharge and quashing',
    lawyerSpecialities: ['Criminal Law', 'IPC', 'CrPC'],
    baseRisk: 74
  },
  Other: {
    domain: 'General Legal Query',
    statutes: [
      { id: 'kl-1', name: 'Legal Services Authorities Act 1987', description: 'Free legal aid through District and State Legal Services Authorities', lastUpdated: '2024-04-18' }
    ],
    evidence: ['Any written records', 'Chronological notes', 'Correspondence', 'Identity documents'],
    documents: ['Written description of the issue', 'Supporting documents', 'Prior correspondence'],
    goals: [
      { icon: 'fa-search', text: 'Identify the correct forum and limitation period' },
      { icon: 'fa-file-signature', text: 'Send a legal notice before litigation' }
    ],
    story: {
      title: 'A Similar Situation',
      summary: 'Sunita was unsure which forum could hear her problem. Free legal aid at the District Legal Services Authority helped her identify it.',
      timeline: [
        { phase: 'Week 1: Issue Framing', text: 'Wrote a one-page chronology and listed what she wanted to achieve' },
        { phase: 'Week 2: Forum & Limitation', text: 'Confirmed the correct authority and whether she was in time' },
        { phase: 'Month 1: Notice Filed', text: 'Legal notice sent, opening the route to settlement or complaint' }
      ],
      outcomes: [
        { type: 'success', title: 'Favorable', description: 'Resolved at notice stage without litigation', timeline: '1-3 months' },
        { type: 'warning', title: 'Mixed', description: 'Referred to the correct forum; process restarts there', timeline: '3-9 months' },
        { type: 'error', title: 'Challenging', description: 'Limitation period had already expired', timeline: 'n/a' }
      ]
    },
    recommendedForum: 'District Legal Services Authority for free legal aid',
    lawyerSpecialities: ['Civil Matters'],
    baseRisk: 40
  }
};

function knowledgeFor(category) {
  return LegalKnowledge[category] || LegalKnowledge.Other;
}

// Demo Data
const DemoData = {
  cases: [
    {
      id: "NS-2025-001",
      risk_level: "Medium",
      urgency: "High",
      domain: "Workplace Harassment",
      status: "Triage Complete",
      completion: 75,
      created: "2025-10-20"
    },
    {
      id: "NS-2025-002",
      risk_level: "Low",
      urgency: "Medium",
      domain: "Consumer Dispute",
      status: "With Lawyer",
      completion: 100,
      created: "2025-10-18"
    }
  ],
  lawyers: [
    {
      name: "Advocate Priya Sharma",
      specialization: ["Family Law", "Domestic Violence", "Divorce"],
      location: "Mumbai, Maharashtra",
      rating: 4.8,
      cases_won: 156,
      response_time: "2 hours",
      fee_structure: "₹2000/consultation",
      availability: true,
      languages: ["English", "Hindi", "Marathi"]
    },
    {
      name: "Advocate Rajesh Kumar",
      specialization: ["Criminal Law", "IPC", "CrPC"],
      location: "Delhi NCR",
      rating: 4.9,
      cases_won: 203,
      response_time: "1 hour",
      fee_structure: "₹3000/consultation",
      availability: true,
      languages: ["English", "Hindi"]
    },
    {
      name: "Advocate Meena Patel",
      specialization: ["Consumer Rights", "Property Law", "Civil Matters"],
      location: "Ahmedabad, Gujarat",
      rating: 4.7,
      cases_won: 128,
      response_time: "3 hours",
      fee_structure: "₹1500/consultation",
      availability: false,
      languages: ["English", "Hindi", "Gujarati"]
    }
  ],
  documents: [
    {
      id: "contract",
      name: "Employment_Contract.pdf",
      type: "Contract",
      upload_date: "2025-10-22",
      size: "2.4 MB",
      status: "Ready"
    },
    {
      id: "evidence",
      name: "Email_Evidence.pdf",
      type: "Evidence",
      upload_date: "2025-10-21",
      size: "1.1 MB",
      status: "Redacted"
    },
    {
      id: "statement",
      name: "Witness_Statement.docx",
      type: "Statement",
      upload_date: "2025-10-20",
      size: "856 KB",
      status: "Processing"
    }
  ],
  analytics: {
    total_cases: 1247,
    completed_cases: 892,
    avg_triage_time: "45 minutes",
    lawyer_response_rate: "94%",
    monthly_trends: [
      { month: "Jul", cases: 95 },
      { month: "Aug", cases: 112 },
      { month: "Sep", cases: 128 },
      { month: "Oct", cases: 145 }
    ],
    topic_distribution: [
      { category: "Family Law", percentage: 32 },
      { category: "Consumer", percentage: 24 },
      { category: "Workplace", percentage: 18 },
      { category: "Property", percentage: 15 },
      { category: "Criminal", percentage: 11 }
    ]
  }
};

// Utility Functions
function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return document.querySelectorAll(selector);
}

function createElement(tag, className = '', innerHTML = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (innerHTML) element.innerHTML = innerHTML;
  return element;
}

function showToast(type, title, message) {
  const toastContainer = $('#toast-container');
  const toast = createElement('div', `toast ${type}`);
  
  const iconMap = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    info: 'fa-info-circle'
  };
  
  toast.innerHTML = `
    <i class="fas ${iconMap[type]} toast-icon"></i>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <p class="toast-message">${escapeHtml(message)}</p>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <i class="fas fa-times"></i>
    </button>
  `;
  
  toastContainer.appendChild(toast);
  announceToScreenReader(`${title}. ${message}`);
  
  // Auto-dismiss after 3 seconds
  setTimeout(() => {
    if (toast.parentElement) {
      toast.remove();
    }
  }, 3000);
}

function formatTime(date) {
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

// Urgency Button Handlers
function setupUrgencyButtons() {
  $$('.urgency-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Scope to the sibling group (handoff row, modal, ...); clearing every
      // .urgency-btn in the document made unrelated controls lose their state.
      const group = btn.parentElement || btn;
      group.querySelectorAll('.urgency-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const urgency = btn.dataset.urgency;
      AppState.caseData.urgency = urgency.charAt(0).toUpperCase() + urgency.slice(1);
      persistState();
      showToast('info', 'Urgency Updated', `Case urgency set to ${urgency}.`);
    });
  });
}

// Video Tutorial Handlers
function playVideoTutorial(videoId) {
  showToast('info', 'Loading Video', 'Video tutorial will open in a new window.');
  
  // In a real app, this would open a video player or modal
  setTimeout(() => {
    showToast('success', 'Video Ready', 'Tutorial video is now playing.');
  }, 1000);
}

function showNotifications() {
  const notifications = [
    { type: 'success', title: 'Lawyer Response', message: 'Advocate Priya Sharma has reviewed your case', time: '5 min ago' },
    { type: 'info', title: 'Document Processed', message: 'Employment_Contract.pdf has been analyzed', time: '1 hour ago' },
    { type: 'warning', title: 'Action Required', message: 'Please upload witness statements', time: '2 hours ago' }
  ];
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';
  
  const content = document.createElement('div');
  content.className = 'modal glass-card';
  content.style.maxWidth = '500px';
  content.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">Notifications</h3>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="modal-body">
      ${notifications.map(n => `
        <div class="notification-item" style="padding: var(--space-md); border-bottom: 1px solid rgba(0,0,0,0.1); cursor: pointer;" onclick="this.closest('.modal-overlay').remove(); showToast('${n.type}', '${n.title}', '${n.message}');">
          <div style="display: flex; align-items: start; gap: var(--space-md);">
            <i class="fas fa-${n.type === 'success' ? 'check-circle' : n.type === 'warning' ? 'exclamation-triangle' : 'info-circle'}" style="color: var(--${n.type === 'success' ? 'accent' : n.type === 'warning' ? 'coral' : 'primary'}-color); font-size: 1.25rem; margin-top: 2px;"></i>
            <div style="flex: 1;">
              <strong style="color: var(--dark-slate);">${n.title}</strong>
              <p style="margin: var(--space-xs) 0; color: var(--color-gray-400); font-size: 0.875rem;">${n.message}</p>
              <small style="color: var(--color-gray-400);">${n.time}</small>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// Enhanced initialization to include all new handlers
function initializeAllHandlers() {
  setupUrgencyButtons();
  setupCaseTabs();

  // Add click handlers for video cards
  $$('.video-card').forEach(card => {
    card.addEventListener('click', () => {
      playVideoTutorial(card.dataset.videoId || 'default');
    });
  });

  // NOTE: automation cards already declare `onclick="runAutomation(type)"` in
  // the markup. Attaching a second listener here (which scraped the handler
  // out of the onclick attribute) made every click fire the action twice.
}

// Case summary tabs
function setupCaseTabs() {
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchCaseTab(btn.dataset.tab));
  });
}

// Update the main initialization to include new handlers
const originalInitializeApp = initializeApp;
initializeApp = function() {
  originalInitializeApp();
  initializeAllHandlers();
};

// Additional helper functions
function showLoadingState(element, text = 'Loading...') {
  const originalContent = element.innerHTML;
  element.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text}`;
  element.disabled = true;
  
  return () => {
    element.innerHTML = originalContent;
    element.disabled = false;
  };
}

function validateForm(formElement) {
  const requiredFields = formElement.querySelectorAll('[required]');
  let isValid = true;
  
  requiredFields.forEach(field => {
    if (!field.value.trim()) {
      field.style.borderColor = 'var(--coral-color)';
      isValid = false;
    } else {
      field.style.borderColor = '';
    }
  });
  
  return isValid;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Enhanced error handling for async operations
function handleAsyncOperation(operation, loadingText = 'Processing...') {
  return new Promise((resolve, reject) => {
    showToast('info', 'Operation Started', loadingText);
    
    operation
      .then(result => {
        showToast('success', 'Operation Complete', 'Action completed successfully.');
        resolve(result);
      })
      .catch(error => {
        console.error('Operation failed:', error);
        showToast('error', 'Operation Failed', 'An error occurred. Please try again.');
        reject(error);
      });
  });
}

function simulateApiDelay(callback, delay = 500) {
  setTimeout(callback, delay);
}

// Navigation Functions
function navigateTo(pageName) {
  // Hide all pages
  $$('.page-content').forEach(page => page.classList.add('hidden'));
  
  // Show target page
  const targetPage = $(`#${pageName}-page`);
  if (targetPage) {
    targetPage.classList.remove('hidden');
  }
  
  // Update nav active state
  $$('.nav-item').forEach(item => item.classList.remove('active'));
  const navItem = $(`.nav-item[data-page="${pageName}"]`);
  if (navItem) {
    navItem.classList.add('active');
  }
  
  AppState.currentPage = pageName;
  announceToScreenReader(`${pageName} page opened`);
  persistState();
  
  // Page-specific initialization
  switch (pageName) {
    case 'dashboard':
      initializeDashboard();
      break;
    case 'intake':
      initializeIntakePage();
      break;
    case 'story-mode':
      initializeStoryMode();
      break;
    case 'case-summary':
      initializeCaseSummary();
      break;
    case 'marketplace':
      initializeMarketplace();
      break;
    case 'documents':
      initializeDocuments();
      break;
    case 'analytics':
      initializeAnalytics();
      break;
    case 'ai-insights':
      initializeAIInsights();
      break;
    case 'policies':
      initializePolicies();
      break;
    case 'settings':
      initializeSettings();
      break;
    case 'help':
      initializeHelp();
      break;
  }
}

// Login/Welcome Page Functions
function startDemo(options = {}) {
  const returning = !options.forceRole && AppState.currentUser;
  if (!returning) {
    AppState.currentUser = { role: options.forceRole || 'user', name: options.forceRole === 'lawyer' ? 'Lawyer' : 'Demo User' };
  }
  persistState();
  enterApp(returning);
}

// Role selection is stored and reflected in the UI (banner + which pages are
// emphasised) instead of being recorded and then ignored.
function selectRole(role) {
  AppState.currentUser = {
    role: role,
    name: role === 'lawyer' ? 'Advocate (demo)' : 'Demo User'
  };
  startDemo({ forceRole: role });
}

function enterApp(returning) {
  const loadingScreen = $('#loading-screen');
  if (loadingScreen) loadingScreen.style.display = 'flex';

  $('#login-page').classList.remove('active');
  $('#main-app').classList.remove('hidden');
  document.body.classList.add('app-active');
  applyRolePresentation();

  setTimeout(() => {
    if (loadingScreen) loadingScreen.style.display = 'none';
    initializeDashboard();
    showToast('success', returning ? 'Welcome back' : 'Welcome!',
      returning
        ? 'Restored your saved case from this browser.'
        : 'Demo mode: everything stays in this browser tab.');
  }, returning ? 400 : 1400);
}

// Seekers see intake/story-mode first; advocates see the case file + documents.
function applyRolePresentation() {
  const isLawyer = AppState.currentUser && AppState.currentUser.role === 'lawyer';
  const seekerOnly = ['intake', 'story-mode'];
  const lawyerOnly = ['analytics'];

  $$('.nav-item').forEach(item => {
    const page = item.dataset.page;
    const hide = (isLawyer && seekerOnly.includes(page)) || (!isLawyer && lawyerOnly.includes(page));
    item.style.display = hide ? 'none' : '';
  });

  const allowed = isLawyer ? ['dashboard', 'case-summary', 'marketplace', 'documents', 'settings'] : ['dashboard', 'intake'];
  if (!allowed.includes(AppState.currentPage)) navigateTo(allowed[0]);
}

// Sidebar Functions
function toggleSidebar() {
  const sidebar = $('#sidebar');
  if (!sidebar) return;
  AppState.sidebarCollapsed = !AppState.sidebarCollapsed;
  sidebar.classList.toggle('collapsed', AppState.sidebarCollapsed);
  sidebar.setAttribute('aria-expanded', String(!AppState.sidebarCollapsed));
  persistState();
}

// Dashboard Functions
function initializeDashboard() {
  applyWidgetVisibility();
  initializeCharts();
  initializeProgressRings();
  initializeGauges();
  updateHeatmap();
  updateDashboardWidgets();
}

function initializeCharts() {
  // Response Time Chart
  const ctx = $('#responseTimeChart');
  if (ctx && !ctx.chart) {
    ctx.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
        datasets: [{
          label: 'Average Response Time (hours)',
          data: [3.2, 2.8, 2.5, 2.1, 1.9, 2.3, 2.0, 1.8, 2.2, 1.6],
          borderColor: '#5A31F4',
          backgroundColor: 'rgba(90, 49, 244, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(0, 0, 0, 0.1)' } },
          x: { grid: { display: false } }
        }
      }
    });
  }
}

function initializeProgressRings() {
  $$('.progress-ring').forEach(ring => {
    const progress = parseInt(ring.dataset.progress, 10) || 0;
    const circle = ring.querySelector('.progress-circle-fill');
    if (!circle) return;
    const circumference = 2 * Math.PI * 50; // radius = 50
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = circumference - (progress / 100) * circumference;
    const value = ring.querySelector('.progress-value');
    if (value) value.textContent = `${progress}%`;
  });

  $$('.progress-ring-small').forEach(ring => {
    const progress = parseInt(ring.dataset.progress, 10) || 0;
    const circle = ring.querySelector('.progress-circle-fill');
    if (!circle) return;
    const circumference = 2 * Math.PI * 16; // radius = 16
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = circumference - (progress / 100) * circumference;
    const text = ring.querySelector('.progress-text-small');
    if (text) text.textContent = `${progress}%`;
  });
}

function initializeGauges() {
  $$('.gauge-meter').forEach(gauge => {
    const value = parseInt(gauge.dataset.value, 10) || 0;
    const needle = gauge.querySelector('.gauge-needle');
    if (!needle) return;
    const angle = (value - 50) * 1.8; // 0-100 -> -90..+90 degrees
    needle.style.transform = `translateX(-50%) rotate(${angle}deg)`;
  });
}

function updateHeatmap() {
  const cells = $$('.heatmap-cell');
  const distribution = DemoData.analytics.topic_distribution;
  const max = Math.max(...distribution.map(row => row.percentage), 1);

  cells.forEach(cell => {
    const label = cell.textContent.trim().toLowerCase();
    const row = distribution.find(entry => entry.category.toLowerCase().startsWith(label));
    const intensity = row ? row.percentage : Number(cell.dataset.intensity || 0);
    cell.dataset.intensity = intensity;
    cell.style.background = `rgba(90, 49, 244, ${(0.22 + (intensity / max) * 0.78).toFixed(2)})`;
    cell.title = `${row ? row.category : cell.textContent.trim()} - ${intensity}%`;
  });
}

// Re-renders the dashboard from AppState so triage/upload/connect actions are
// reflected immediately instead of leaving the markup frozen.
function updateDashboardWidgets() {
  const widget = selector => $(`.widget[data-widget="${selector}"]`);
  const data = AppState.caseData;

  const statusWidget = widget('case-status');
  if (statusWidget) {
    const ring = statusWidget.querySelector('.progress-ring');
    if (ring) {
      ring.dataset.progress = AppState.intakeProgress.completion;
      const label = statusWidget.querySelector('.progress-label');
      if (label) label.textContent = data.status;
    }
    initializeProgressRings();
  }

  const stepsWidget = widget('next-steps');
  if (stepsWidget) {
    const list = stepsWidget.querySelector('.checklist');
    if (list) {
      list.innerHTML = nextStepItems().map(item => `
        <div class="checklist-item${item.done ? ' completed' : ''}">
          <input type="checkbox" ${item.done ? 'checked' : ''} disabled>
          <span>${escapeHtml(item.text)}</span>
          <i class="fas fa-${item.done ? 'check-circle' : 'circle'}"></i>
        </div>
      `).join('');
    }
  }

  const docsWidget = widget('documents');
  if (docsWidget) {
    const ready = AppState.documents.filter(doc => doc.status === 'Ready').length;
    const total = AppState.documents.length;
    const items = docsWidget.querySelectorAll('.progress-item');
    if (items[0]) {
      items[0].querySelector('.progress-fill').style.width = `${total ? Math.round(ready / total * 100) : 0}%`;
      items[0].querySelector('.progress-item-value').textContent = `${ready}/${total || 0}`;
    }
    if (items[1]) {
      items[1].querySelector('.progress-fill').style.width = `${total ? Math.round(ready / total * 100) : 0}%`;
      items[1].querySelector('.progress-item-value').textContent = `${ready}/${total || 0}`;
    }
  }

  const riskWidget = widget('risk-assessment');
  if (riskWidget) {
    const risk = riskForCurrentCase();
    const gauge = riskWidget.querySelector('.gauge-meter');
    if (gauge) {
      gauge.dataset.value = Math.round(risk.overall);
      initializeGauges();
    }
    const factors = riskWidget.querySelector('.risk-factors');
    if (factors) {
      factors.innerHTML = Object.entries(risk.factors)
        .slice(0, 3)
        .map(([key, value]) => `<div class="risk-factor">${escapeHtml(factorLabel(key))} · ${levelFor(value)}</div>`)
        .join('');
    }
  }

  if (AppState.currentPage === 'dashboard') updateHeatmap();
}

// Widget Functions
function toggleWidgetMenu(widgetId) {
  const dropdown = $(`.widget[data-widget="${widgetId}"] .widget-menu-dropdown`);
  dropdown.classList.toggle('hidden');
  
  // Close other dropdowns
  $$('.widget-menu-dropdown').forEach(menu => {
    if (menu !== dropdown) {
      menu.classList.add('hidden');
    }
  });
}

function exportWidget(widgetId, format) {
  showToast('info', 'Export Started', `Exporting ${widgetId} as ${format.toUpperCase()}...`);

  setTimeout(() => {
    const data = generateWidgetExportData(widgetId);
    if (format === 'csv') {
      downloadFile(`${widgetId}_${Date.now()}.csv`, data.csv, 'text/csv;charset=utf-8');
    } else {
      downloadFile(`${widgetId}_${Date.now()}.pdf`, buildSimplePdf(data.title, data.lines), 'application/pdf');
    }

    showToast('success', 'Export Complete', `${widgetId} exported.`);
  }, 800);

  const dropdown = $(`.widget[data-widget="${widgetId}"] .widget-menu-dropdown`);
  if (dropdown) dropdown.classList.add('hidden');
}

function generateWidgetExportData(widgetId) {
  const timestamp = new Date().toISOString();
  const data = AppState.caseData;
  const risk = riskForCurrentCase();

  const rows = {
    'case-status': [
      ['field', 'value'],
      ['case_id', data.id],
      ['domain', data.domain],
      ['status', data.status],
      ['completion', AppState.intakeProgress.completion],
      ['exported_at', timestamp]
    ],
    'next-steps': [
      ['field', 'value'],
      ...nextStepItems().map((item, index) => [`step_${index + 1}`, item.text + (item.done ? ' (done)' : '')])
    ],
    'documents': [
      ['name', 'type', 'date', 'size', 'status'],
      ...AppState.documents.map(doc => [doc.name, doc.type, doc.upload_date, doc.size, doc.status])
    ],
    'lawyer-response': [
      ['month', 'average_hours'],
      ['Jul', 3.2], ['Aug', 2.1], ['Sep', 2.2], ['Oct', 1.6]
    ],
    'risk-assessment': [
      ['factor', 'score'],
      ...Object.entries(risk.factors).map(([key, value]) => [factorLabel(key), Math.round(value)]),
      ['overall', Math.round(risk.overall)],
      ['level', data.risk_level]
    ],
    'topic-heatmap': [
      ['category', 'share_percent'],
      ...DemoData.analytics.topic_distribution.map(row => [row.category, row.percentage])
    ]
  };

  const table = rows[widgetId] || [['field', 'value'], ['widget', widgetId], ['exported_at', timestamp]];

  return {
    title: `NyaySaathi widget: ${widgetId}`,
    lines: table.map(row => row.join('  |  ')),
    csv: table.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  };
}

function nextStepItems() {
  const docsReady = AppState.documents.some(doc => doc.status === 'Ready');
  return [
    { text: 'Complete the confidential intake', done: AppState.intakeProgress.completion === 100 },
    { text: 'Upload supporting documents', done: docsReady },
    { text: 'Review the case summary', done: !!AppState.caseData.triagedAt },
    { text: 'Connect with a lawyer', done: AppState.lawyerAssignments.length > 0 }
  ];
}

// FAB Functions
function toggleFAB() {
  const fabActions = $('.fab-actions');
  const fabMain = $('.fab-main');
  
  fabActions.classList.toggle('hidden');
  AppState.fabExpanded = !AppState.fabExpanded;
  
  if (AppState.fabExpanded) {
    fabMain.innerHTML = '<i class="fas fa-times"></i>';
    fabMain.style.transform = 'rotate(90deg)';
  } else {
    fabMain.innerHTML = '<i class="fas fa-plus"></i>';
    fabMain.style.transform = 'rotate(0deg)';
  }
}

// Intake Functions
function initializeIntakePage() {
  const intakeInterface = $('#intake-interface');
  const chatMessages = $('#chat-messages');
  if (!intakeInterface || !chatMessages) return;

  // Returning to this page must not destroy the answers already collected -
  // they feed the case summary, story mode and export.
  chatMessages.innerHTML = `
    <div class="message ai-message">
      <div class="message-content">
        <p>Hello! I'm here to help you understand your legal situation. Everything stays in this browser. Let's start with some basic information.</p>
      </div>
      <div class="message-time">Just now</div>
    </div>`;

  if (AppState.intakeProgress.completion === 100) {
    intakeInterface.classList.remove('hidden');
    const { ageRange, category } = AppState.intakeProgress;
    addUserMessage(`I am ${escapeHtml(ageRange)} years old`);
    addUserMessage(`My situation is related to ${escapeHtml(category)}`);
    addUserMessage(AppState.intakeProgress.description || '');
    updateIntakeProgress();
    setTimeout(() => {
      addAIMessage('You have already completed intake. You can keep adding detail here, or open your case summary to review what was captured.');
      const resume = createElement('div', 'message ai-message');
      resume.innerHTML = `
        <div class="message-content">
          <p>Current triage: <strong>${escapeHtml(AppState.caseData.domain || 'not set')}</strong>, risk <strong>${escapeHtml(AppState.caseData.risk_level || 'n/a')}</strong>.</p>
          <button class="btn btn-primary" onclick="navigateTo('case-summary')" style="margin-top:12px;">Open Case Summary <i class="fas fa-arrow-right"></i></button>
        </div>
        <div class="message-time">Just now</div>`;
      chatMessages.appendChild(resume);
    }, 300);
  } else {
    intakeInterface.classList.toggle('hidden', AppState.intakeProgress.step === 0);
    updateIntakeProgress();
  }
}

function startIntake() {
  const intakeInterface = $('#intake-interface');
  if (!intakeInterface) return;
  intakeInterface.classList.remove('hidden');

  const progress = AppState.intakeProgress;

  if (progress.ageRange && progress.category) {
    addAIMessage('You have already given the basics. Describe your situation in your own words, and I will triage it.');
    enableTextInput();
    return;
  }
  if (progress.ageRange) {
    addAIMessage('Thanks - you already shared your age range. Which category best describes your situation?');
    addCategoryButtons();
    return;
  }

  addAIMessage("To provide you with the most relevant guidance, I'd like to know your age range. This helps me understand the legal context better.");
  simulateApiDelay(() => addAgeRangeButtons(), 700);
}

function addAIMessage(text) {
  const chatMessages = $('#chat-messages');
  const message = createElement('div', 'message ai-message');

  message.innerHTML = `
    <div class="message-content">
      <p>${escapeHtml(text)}</p>
    </div>
    <div class="message-time">${formatTime(new Date())}</div>
  `;
  
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addUserMessage(text) {
  const chatMessages = $('#chat-messages');
  const message = createElement('div', 'message user-message');

  message.innerHTML = `
    <div class="message-content">
      <p>${escapeHtml(text)}</p>
    </div>
    <div class="message-time">${formatTime(new Date())}</div>
  `;
  
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addAgeRangeButtons() {
  const chatMessages = $('#chat-messages');
  const ageRanges = ['18-25', '26-40', '41-60', '60+'];
  
  const buttonContainer = createElement('div', 'message ai-message');
  const buttonsHTML = ageRanges.map(range => 
    `<button class="btn btn-secondary" onclick="selectAgeRange('${range}')" style="margin: 4px;">${range}</button>`
  ).join('');
  
  buttonContainer.innerHTML = `
    <div class="message-content">
      <p>Please select your age range:</p>
      <div style="margin-top: 12px;">
        ${buttonsHTML}
      </div>
    </div>
    <div class="message-time">Just now</div>
  `;
  
  chatMessages.appendChild(buttonContainer);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function selectAgeRange(range) {
  AppState.intakeProgress.ageRange = range;
  AppState.intakeProgress.step = 1;
  AppState.intakeProgress.completion = 33;
  persistState();
  
  addUserMessage(`I am ${range} years old`);
  
  // Update progress ring
  updateIntakeProgress();
  
  setTimeout(() => {
    addAIMessage("Thank you. Now, which category best describes your situation?");
    setTimeout(() => {
      addCategoryButtons();
    }, 1000);
  }, 500);
}

function addCategoryButtons() {
  const chatMessages = $('#chat-messages');
  const categories = ['Family', 'Workplace', 'Property', 'Criminal', 'Consumer', 'Other'];
  
  const buttonContainer = createElement('div', 'message ai-message');
  const buttonsHTML = categories.map(category => 
    `<button class="btn btn-secondary" onclick="selectCategory('${category}')" style="margin: 4px;">${category}</button>`
  ).join('');
  
  buttonContainer.innerHTML = `
    <div class="message-content">
      <p>Please select the relevant category:</p>
      <div style="margin-top: 12px;">
        ${buttonsHTML}
      </div>
    </div>
    <div class="message-time">Just now</div>
  `;
  
  chatMessages.appendChild(buttonContainer);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function selectCategory(category) {
  AppState.intakeProgress.category = category;
  AppState.intakeProgress.step = 2;
  AppState.intakeProgress.completion = 66;
  AppState.caseData.category = category;
  AppState.caseData.domain = knowledgeFor(category).domain;
  persistState();
  renderStoryMode();
  renderLawyerCards();
  
  addUserMessage(`My situation is related to ${category}`);
  
  // Update progress ring
  updateIntakeProgress();
  
  setTimeout(() => {
    addAIMessage("Perfect. Please describe your situation in detail. Take your time and include any relevant information you think might be important.");
    setTimeout(() => {
      enableTextInput();
    }, 1000);
  }, 500);
}

function showTypingIndicator(on) {
  const indicator = $('.typing-indicator');
  if (indicator) indicator.classList.toggle('hidden', !on);
}

function enableTextInput() {
  const chatInput = $('#chat-input');
  chatInput.placeholder = "Describe your situation in detail...";
  chatInput.focus();
}

function handleChatInput(event) {
  if (event.key === 'Enter') {
    sendMessage();
  }
}

function sendMessage() {
  const chatInput = $('#chat-input');
  const message = chatInput.value.trim();
  
  if (message) {
    if (AppState.intakeProgress.step === 2) {
      AppState.intakeProgress.description = message;
      AppState.intakeProgress.step = 3;
      AppState.intakeProgress.completion = 100;
      AppState.caseData.description = message;
      persistState();
      
      addUserMessage(message);
      chatInput.value = '';
      
      // Update progress ring
      updateIntakeProgress();
      
      setTimeout(() => {
        addAIMessage("Thank you for sharing this information. I'll analyze your situation and provide relevant guidance. This may take a moment...");
        
        showTypingIndicator(true);
        setTimeout(() => {
          showTypingIndicator(false);
          completeIntake();
        }, 2000);
      }, 500);
    } else {
      addUserMessage(message);
      chatInput.value = '';

      showTypingIndicator(true);
      setTimeout(() => {
        showTypingIndicator(false);
        addAIMessage(generateAIResponse(message, AppState.intakeProgress.category));
      }, 1000);
    }
  }
}

function updateIntakeProgress() {
  const progressRing = $('.progress-ring-small');
  if (progressRing) {
    progressRing.dataset.progress = AppState.intakeProgress.completion;
    const progressText = progressRing.querySelector('.progress-text-small');
    progressText.textContent = `${AppState.intakeProgress.completion}%`;
    
    const circle = progressRing.querySelector('.progress-circle-fill');
    const circumference = 2 * Math.PI * 16;
    const offset = circumference - (AppState.intakeProgress.completion / 100) * circumference;
    circle.style.strokeDashoffset = offset;
  }
}

function completeIntake() {
  const triage = triageIntake();
  AppState.caseData = Object.assign({}, AppState.caseData, triage.caseData);
  updateCaseProgress(AppState.caseData.id, triage.caseData.status, triage.caseData.completion);
  persistState();

  addAIMessage(triage.summary);

  setTimeout(() => {
    const continueButton = createElement('div', 'message ai-message');
    continueButton.innerHTML = `
      <div class="message-content">
        <p>Domain: <strong>${escapeHtml(triage.domain)}</strong> &middot;
           Risk: <strong>${escapeHtml(triage.riskLevel)}</strong> &middot;
           Urgency: <strong>${escapeHtml(triage.urgency)}</strong></p>
        <p style="margin-top: 8px;">Relevant law: ${triage.statutes.map(s => escapeHtml(s.name)).join(', ')}</p>
        <button class="btn btn-primary" onclick="navigateTo('story-mode')" style="margin-top: 12px;">
          View Similar Cases &amp; Legal Guidance
          <i class="fas fa-arrow-right"></i>
        </button>
      </div>
      <div class="message-time">Just now</div>
    `;

    $('#chat-messages').appendChild(continueButton);
    $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
  }, 1500);
}

// Triage: turn the collected intake answers into the case profile that the
// story-mode, case-summary, export and dashboard views all read from.
function triageIntake() {
  const { ageRange, category, description } = AppState.intakeProgress;
  const knowledge = knowledgeFor(category);
  const text = String(description || '');

  const risk = calculateRiskAssessment({
    baseRisk: knowledge.baseRisk,
    hasEvidence: /\b(email|photo|record|witness|document|msg|message|screenshot|invoice|receipt|report)\w*/i.test(text),
    documentedForMonths: monthsMentioned(text),
    urgencyWords: /\b(threat|hurt|again|today|urgent|immediately|danger|blackmail|suicide)\b/i.test(text),
    minorOrElderly: ageRange === '18-25' || ageRange === '60+'
  });

  const urgency = risk.overall >= 70 ? 'High' : risk.overall >= 40 ? 'Medium' : 'Low';
  const statutes = knowledge.statutes;
  const matched = matchLawyers({ specialities: knowledge.lawyerSpecialities }, {});

  return {
    domain: knowledge.domain,
    category: category || 'Other',
    riskLevel: risk.level,
    riskScore: risk.overall,
    riskFactors: risk.factors,
    urgency,
    statutes,
    evidence: knowledge.evidence,
    documents: knowledge.documents,
    goals: knowledge.goals,
    recommendedLawyers: matched.slice(0, 2).map(lawyer => lawyer.name),
    summary: `Thank you. Based on what you described, this looks like a ${knowledge.domain.toLowerCase()} matter with a ${risk.level.toLowerCase()} risk level. Here is what usually applies: ${statutes.map(s => s.name).join(' and ')}. Strengthening your evidence is the single most useful thing you can do right now.`,
    caseData: {
      id: AppState.caseData.id,
      domain: knowledge.domain,
      category: category || 'Other',
      ageRange: ageRange || null,
      description: text,
      risk_level: risk.level,
      risk_score: Math.round(risk.overall),
      urgency,
      status: 'Triage Complete',
      completion: 100,
      statutes: statutes.map(s => s.name),
      statuteDetails: statutes,
      risk_factors: risk.factors,
      forum: knowledge.recommendedForum,
      created: AppState.caseData.created || new Date().toISOString().split('T')[0],
      triagedAt: new Date().toISOString()
    }
  };
}

function monthsMentioned(text) {
  const match = String(text).match(/(\d+)\s*(?:month|mo|week)\w*/i);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  return /week|mo\b/i.test(match[0]) ? Math.max(1, Math.round(value / 4)) : value;
}

function toggleVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const chatInput = $('#chat-input');

  if (!SpeechRecognition) {
    showToast('info', 'Voice Input', 'This browser has no speech recognition engine, so dictation is unavailable.');
    return;
  }

  if (AppState.recognition) {
    AppState.recognition.stop();
    AppState.recognition = null;
    showToast('info', 'Voice Input', 'Dictation stopped.');
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = AppState.settings.language === 'hi' ? 'hi-IN' : 'en-IN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    chatInput.value = `${chatInput.value} ${transcript}`.trim();
    showToast('success', 'Dictation Captured', 'Review the text before sending.');
  };
  recognition.onerror = () => showToast('error', 'Dictation Failed', 'Microphone unavailable or not permitted.');
  recognition.onend = () => { AppState.recognition = null; };

  AppState.recognition = recognition;
  try {
    recognition.start();
    showToast('info', 'Listening', 'Speak now - your words appear in the input box.');
  } catch (error) {
    AppState.recognition = null;
    showToast('error', 'Dictation Failed', 'Could not start the microphone.');
  }
}

// Story Mode Functions
let currentOutcome = 0;
let storyOutcomes = [];

function currentCategory() {
  return AppState.intakeProgress.category || AppState.caseData.category || 'Workplace';
}

function initializeStoryMode() {
  renderStoryMode();
}

function renderStoryMode() {
  const knowledge = knowledgeFor(currentCategory());
  const story = knowledge.story;
  storyOutcomes = story.outcomes;
  currentOutcome = 0;

  $('#storyTitle').textContent = story.title;
  $('#storySummary').innerHTML = `<strong>Case study:</strong> ${escapeHtml(story.summary)}`;

  $('#storyTimeline').innerHTML = story.timeline.map(step => `
    <div class="timeline-item">
      <div class="timeline-marker"></div>
      <div class="timeline-content">
        <h4>${escapeHtml(step.phase)}</h4>
        <p>${escapeHtml(step.text)}</p>
      </div>
    </div>
  `).join('');

  $('#outcomeCards').innerHTML = story.outcomes.map((outcome, index) => `
    <div class="outcome-card${index === 0 ? ' active' : ''}">
      <div class="outcome-type ${escapeHtml(outcome.type)}">${escapeHtml(outcome.title)}</div>
      <p>${escapeHtml(outcome.description)}</p>
      <small>Timeline: ${escapeHtml(outcome.timeline)}</small>
    </div>
  `).join('');

  $('#storyLegalSections').innerHTML = knowledge.statutes.map(statute => `
    <div class="legal-section expandable">
      <div class="section-header" onclick="toggleSection('story-${escapeHtml(statute.id)}')">
        <h4>${escapeHtml(statute.name)}</h4>
        <i class="fas fa-chevron-down"></i>
      </div>
      <div class="section-content" id="story-${escapeHtml(statute.id)}">
        <p>${escapeHtml(statute.description)}</p>
        <div class="last-updated">Last updated: ${escapeHtml(statute.lastUpdated)}</div>
      </div>
    </div>
  `).join('');

  const risk = riskForCurrentCase();
  $('#storyRiskIndicators').innerHTML = Object.entries(risk.factors).map(([key, value]) => `
    <div class="risk-indicator ${riskBand(value)}">
      <span class="risk-label">${escapeHtml(factorLabel(key))}</span>
      <div class="risk-level">${escapeHtml(levelFor(value))}</div>
    </div>
  `).join('');

  const evidenceHeld = /(email|witness|photo|record|document|receipt|invoice|report|screenshot)\w*/i
    .test(AppState.intakeProgress.description || '');
  $('#storyInsights').innerHTML = [
    {
      icon: 'fa-gavel',
      label: 'Most decisive factor',
      text: `${knowledge.domain} matters are usually decided on contemporaneous records rather than recollection.`
    },
    {
      icon: 'fa-chart-line',
      label: 'Evidence',
      text: evidenceHeld
        ? 'You mentioned supporting material. Keep originals untouched and index them by date.'
        : 'No supporting material mentioned yet. Start a dated written log today, before memory fades.'
    },
    {
      icon: 'fa-users',
      label: 'Who to involve',
      text: knowledge.recommendedForum || 'A lawyer can tell you whether to file, negotiate, or wait.'
    }
  ].map(item => `
    <div class="insight-item">
      <i class="fas ${item.icon}"></i>
      <div>
        <strong>${escapeHtml(item.label)}:</strong>
        <p>${escapeHtml(item.text)}</p>
      </div>
    </div>
  `).join('');

  $('#storyDocChecklist').innerHTML = knowledge.documents.map(doc => `
    <div class="checklist-item">
      <i class="fas fa-file-alt"></i>
      <span>${escapeHtml(doc)}</span>
    </div>
  `).join('');
}

function riskBand(value) {
  return value < 33 ? 'low' : value < 66 ? 'medium' : 'high';
}

function levelFor(value) {
  return value < 33 ? 'Low' : value < 66 ? 'Medium' : 'High';
}

function factorLabel(key) {
  return {
    legalComplexity: 'Legal Complexity',
    evidenceQuality: 'Evidence Quality',
    timelineUrgency: 'Timeline Pressure',
    oppositionStrength: 'Opposition Strength'
  }[key] || key;
}

// Risk for the current case: recomputed from state so every view agrees.
function riskForCurrentCase() {
  if (AppState.caseData.risk_score != null && AppState.caseData.risk_factors) {
    return {
      overall: AppState.caseData.risk_score,
      factors: AppState.caseData.risk_factors,
      level: AppState.caseData.risk_level
    };
  }
  return calculateRiskAssessment({ baseRisk: knowledgeFor(currentCategory()).baseRisk });
}

function nextOutcome() {
  if (!storyOutcomes.length) return;
  currentOutcome = (currentOutcome + 1) % storyOutcomes.length;
  updateOutcomeDisplay();
}

function previousOutcome() {
  if (!storyOutcomes.length) return;
  currentOutcome = (currentOutcome - 1 + storyOutcomes.length) % storyOutcomes.length;
  updateOutcomeDisplay();
}

function updateOutcomeDisplay() {
  $$('.outcome-card').forEach((card, index) => {
    card.classList.toggle('active', index === currentOutcome);
  });
}

function toggleSection(sectionId) {
  const section = $(`#${sectionId}`);
  const header = section.previousElementSibling;
  
  if (section.classList.contains('expanded')) {
    section.classList.remove('expanded');
    header.classList.remove('expanded');
  } else {
    section.classList.add('expanded');
    header.classList.add('expanded');
  }
}

// Case Summary Functions
function initializeCaseSummary() {
  switchCaseTab(AppState.activeCaseTab || 'overview');
  populateCaseSummary();
}

// Renders the summary from AppState so the page reflects the actual intake
// answers (falling back to the seeded demo case when triage has not run).
function populateCaseSummary() {
  const data = caseForDisplay();
  const knowledge = knowledgeFor(data.category);

  $('#caseIdBadge').textContent = `Case ID: ${data.id}`;

  const riskBadge = $('#caseRiskBadge');
  riskBadge.textContent = `${data.risk_level} Risk`;
  riskBadge.className = `risk-indicator ${String(data.risk_level).toLowerCase()}`;

  const urgencyBadge = $('#caseUrgencyBadge');
  urgencyBadge.textContent = `Urgency: ${data.urgency}`;
  urgencyBadge.className = `urgency-indicator ${String(data.urgency).toLowerCase()}`;

  $('#caseTags').innerHTML = [knowledge.domain, ...knowledge.statutes.map(s => s.name)]
    .map(tag => `<span class="case-tag">${escapeHtml(tag)}</span>`).join('');

  $('#caseFacts').innerHTML = [
    { label: 'Situation', value: data.description || 'Not yet described - complete the confidential intake to fill this in.' },
    { label: 'Reported age range', value: data.ageRange || 'Not provided' },
    { label: 'Evidence available', value: evidenceFound(data.description, knowledge) },
    { label: 'Recommended forum', value: knowledge.recommendedForum }
  ].map(fact => `
    <div class="fact-item">
      <strong>${escapeHtml(fact.label)}:</strong>
      <p>${escapeHtml(fact.value)}</p>
    </div>
  `).join('');

  const score = caseCompleteness();
  $('#caseQualityFill').style.width = `${score}%`;
  $('#caseQualityValue').textContent = `${score}%`;
  $('#caseQualityAlerts').innerHTML = completenessGaps().map(gap => `
    <div class="alert-item ${gap.type}">
      <i class="fas fa-${gap.type === 'info' ? 'info-circle' : 'exclamation-triangle'}"></i>
      <span>${escapeHtml(gap.text)}</span>
    </div>
  `).join('');

  $('#caseTimeline').innerHTML = caseTimeline(data, knowledge).map(event => `
    <div class="timeline-event${event.current ? ' current' : ''}">
      <div class="timeline-date">${escapeHtml(event.date)}</div>
      <div class="timeline-marker"></div>
      <div class="timeline-description">
        <strong>${escapeHtml(event.title)}</strong>
        <p>${escapeHtml(event.text)}</p>
      </div>
    </div>
  `).join('');

  $('#caseLegalSections').innerHTML = knowledge.statutes.map(statute => `
    <div class="legal-section-item">
      <div class="section-info">
        <h4>${escapeHtml(statute.name)}</h4>
        <p>${escapeHtml(statute.description)}</p>
        <div class="last-updated">Last updated: ${escapeHtml(statute.lastUpdated)}</div>
      </div>
    </div>
  `).join('');

  $('#caseGoals').innerHTML = knowledge.goals.map(goal => `
    <div class="goal-item">
      <i class="fas ${escapeHtml(goal.icon)}"></i>
      <span>${escapeHtml(goal.text)}</span>
    </div>
  `).join('');
}

function caseForDisplay() {
  const base = AppState.caseData;
  if (base.triagedAt) return base;
  return Object.assign({
    category: 'Workplace',
    description: 'Workplace harassment by a supervisor involving inappropriate comments and behaviour over a 3-month period.',
    ageRange: null
  }, base, {
    risk_level: base.risk_level || 'Medium',
    urgency: base.urgency || 'High'
  });
}

function evidenceFound(description, knowledge) {
  const text = String(description || '').toLowerCase();
  const found = knowledge.evidence.filter(item => {
    const key = item.split(' ')[0].toLowerCase();
    return text.includes(key) || text.includes(item.toLowerCase());
  });
  const missing = knowledge.evidence.filter(item => !found.includes(item));
  if (!found.length) return `None mentioned yet. Collect: ${missing.join(', ')}.`;
  return `${found.join(', ')}${missing.length ? ` - still missing: ${missing.join(', ')}` : ''}.`;
}

function caseCompleteness() {
  let score = 0;
  if (AppState.intakeProgress.ageRange) score += 15;
  if (AppState.intakeProgress.category) score += 15;
  if (String(AppState.intakeProgress.description || '').length > 40) score += 30;
  score += Math.min(25, AppState.documents.filter(doc => doc.status === 'Ready').length * 9);
  if (AppState.lawyerAssignments.length) score += 15;
  return Math.min(100, score);
}

function completenessGaps() {
  const gaps = [];
  if (String(AppState.intakeProgress.description || '').length <= 40) {
    gaps.push({ type: 'warning', text: 'Add a fuller account in the confidential intake - it drives everything else.' });
  }
  if (!AppState.documents.some(doc => doc.status === 'Ready')) {
    gaps.push({ type: 'warning', text: 'No processed documents yet. Upload the evidence list for your matter.' });
  }
  if (!AppState.lawyerAssignments.length) {
    gaps.push({ type: 'info', text: 'No lawyer connected yet. The summary is ready to share when you are.' });
  }
  if (!gaps.length) {
    gaps.push({ type: 'info', text: 'Your case file looks complete and ready for consultation.' });
  }
  return gaps;
}

function caseTimeline(data, knowledge) {
  const when = data.triagedAt ? new Date(data.triagedAt) : new Date();
  const label = when.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return [
    { date: label, title: 'Intake completed', text: `${knowledge.domain} triage recorded with ${data.risk_level} risk.` },
    { date: label, title: 'Evidence reviewed', text: `${AppState.documents.length} document(s) on file for this matter.` },
    { date: 'Next', title: 'Lawyer consultation', current: true, text: data.lawyer
      ? `Connected with ${data.lawyer}.`
      : 'Share this summary with a matched lawyer for advice on filing.' }
  ];
}

function switchCaseTab(tabName) {
  AppState.activeCaseTab = tabName;

  // Hide all tab panels
  $$('.tab-panel').forEach(panel => panel.classList.remove('active'));

  // Show target panel
  const targetPanel = $(`#${tabName}-panel`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }

  // Update tab button states. The button is resolved from the tab name rather
  // than the implicit global `event`, so this also works when called from JS
  // (e.g. initializeCaseSummary) instead of only from an inline click.
  $$('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
}

function editCase() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';

  const content = document.createElement('div');
  content.className = 'modal glass-card';
  content.style.maxWidth = '600px';
  const currentCategory = AppState.caseData.category || 'Workplace';
  content.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">Edit Case Details</h3>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-group" style="margin-bottom: var(--space-md);">
        <label for="editCaseCategory" style="display:block;margin-bottom:var(--space-sm);font-weight:500;">Case Category</label>
        <select id="editCaseCategory" class="form-select" style="width: 100%; padding: var(--space-sm) var(--space-md); border: 1px solid rgba(0,0,0,0.2); border-radius: var(--radius-sm);">
          ${Object.keys(LegalKnowledge).map(cat => `<option value="${cat}"${cat === currentCategory ? ' selected' : ''}>${escapeHtml(knowledgeFor(cat).domain)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom: var(--space-md);">
        <label style="display:block;margin-bottom:var(--space-sm);font-weight:500;">Urgency Level</label>
        <div style="display:flex;gap:var(--space-sm);">
          ${['low','medium','high'].map(level => `
            <button class="urgency-btn${(AppState.caseData.urgency || '').toLowerCase() === level ? ' active' : ''}"
                    data-urgency="${level}"
                    style="flex:1;padding:var(--space-sm);border:1px solid rgba(0,0,0,0.2);background:white;border-radius:var(--radius-sm);cursor:pointer;">${level.charAt(0).toUpperCase() + level.slice(1)}</button>`).join('')}
        </div>
      </div>
      <div class="form-group" style="margin-bottom: var(--space-lg);">
        <label for="editCaseNotes" style="display:block;margin-bottom:var(--space-sm);font-weight:500;">Notes</label>
        <textarea id="editCaseNotes" rows="4" placeholder="Add any additional information..." style="width: 100%; padding: var(--space-sm) var(--space-md); border: 1px solid rgba(0,0,0,0.2); border-radius: var(--radius-sm); font-family: var(--font-family-body);">${escapeHtml(AppState.caseData.notes || '')}</textarea>
      </div>
      <button class="btn btn-primary" id="editCaseSave" style="width: 100%;">
        <i class="fas fa-save"></i> Save Changes
      </button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  let chosenUrgency = (AppState.caseData.urgency || 'Medium');
  modal.querySelectorAll('.urgency-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.urgency-btn').forEach(b => {
        b.classList.remove('active');
        b.style.border = '1px solid rgba(0,0,0,0.2)';
        b.style.background = 'white';
        b.style.color = 'inherit';
      });
      btn.classList.add('active');
      btn.style.border = '1px solid var(--primary-color)';
      btn.style.background = 'var(--primary-color)';
      btn.style.color = 'white';
      chosenUrgency = btn.dataset.urgency.charAt(0).toUpperCase() + btn.dataset.urgency.slice(1);
    });
  });

  modal.querySelector('#editCaseSave').addEventListener('click', () => {
    const category = modal.querySelector('#editCaseCategory').value;
    const knowledge = knowledgeFor(category);

    AppState.intakeProgress.category = category;
    AppState.caseData = Object.assign({}, AppState.caseData, {
      category,
      domain: knowledge.domain,
      statutes: knowledge.statutes.map(statute => statute.name),
      statuteDetails: knowledge.statutes,
      risk_factors: null,
      urgency: chosenUrgency,
      notes: modal.querySelector('#editCaseNotes').value.trim(),
      editedAt: new Date().toISOString()
    });

    persistState();
    populateCaseSummary();
    renderStoryMode();
    renderLawyerCards();
    updateDashboardWidgets();
    modal.remove();
    showToast('success', 'Case Updated', `Re-triaged as ${knowledge.domain}. Story mode and lawyers updated too.`);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

// Marketplace Functions
function initializeMarketplace() {
  renderLawyerCards();
  setupMarketplaceFilters();
}

// Cards are rendered from DemoData so the list, the filters and the AI
// matching all read the same source of truth.
function renderLawyerCards() {
  const grid = $('#lawyersGrid');
  if (!grid) return;

  const filters = readMarketplaceFilters();
  const recommendations = matchLawyers(
    { specialities: knowledgeFor(currentCategory()).lawyerSpecialities, domain: AppState.caseData.domain },
    {}
  );
  const scored = new Map(recommendations.map(lawyer => [lawyer.name, Math.round(lawyer.matchScore)]));

  const searched = filters.query ? searchLawyers(filters.query, {}) : DemoData.lawyers;
  const visible = searched.filter(lawyer => matchesMarketplaceFilters(lawyer, filters));

  if (!visible.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: var(--space-2xl); color: var(--color-gray-400);">
        <i class="fas fa-user-search" style="font-size: 2rem; opacity: .4;"></i>
        <p>No advocate matches those filters. Try widening the fee range or clearing the location.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = visible
    .sort((a, b) => (scored.get(b.name) || 0) - (scored.get(a.name) || 0))
    .map(lawyer => {
      const fee = feeValue(lawyer.fee_structure);
      const match = scored.get(lawyer.name);
      return `
      <div class="lawyer-card glass-card${lawyer.availability ? '' : ' offline'}" data-lawyer="${escapeHtml(lawyer.name)}">
        <div class="lawyer-photo">
          <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 24 24' fill='%235A31F4'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E" alt="">
          <div class="availability-status ${lawyer.availability ? 'online' : 'offline'}"></div>
        </div>
        <div class="lawyer-info">
          <h3>${escapeHtml(lawyer.name)}</h3>
          <div class="lawyer-rating">
            <div class="stars">${starMarkup(lawyer.rating)}</div>
            <span class="rating-value">${lawyer.rating}</span>
            ${match != null ? `<span class="spec-tag" style="margin-left:auto;">${match}% fit</span>` : ''}
          </div>
          <div class="specializations">
            ${lawyer.specialization.map(spec => `<span class="spec-tag">${escapeHtml(spec)}</span>`).join('')}
          </div>
          <div class="lawyer-details">
            <div class="detail-item"><i class="fas fa-map-marker-alt"></i><span>${escapeHtml(lawyer.location)}</span></div>
            <div class="detail-item"><i class="fas fa-clock"></i><span>Responds in ${escapeHtml(lawyer.response_time)}</span></div>
            <div class="detail-item"><i class="fas fa-rupee-sign"></i><span>₹${fee}/consultation</span></div>
            <div class="detail-item"><i class="fas fa-trophy"></i><span>${lawyer.cases_won} cases won</span></div>
          </div>
          <div class="lawyer-languages"><strong>Languages:</strong> ${escapeHtml(lawyer.languages.join(', '))}</div>
        </div>
        <div class="lawyer-actions">
          <button class="btn btn-secondary" onclick="viewLawyerProfile('${escapeHtml(lawyer.name)}')">View Profile</button>
          ${lawyer.availability
            ? `<button class="btn btn-primary" onclick="connectWithLawyer('${escapeHtml(lawyer.name)}')">Connect Now</button>`
            : '<button class="btn btn-secondary disabled">Currently Offline</button>'}
        </div>
      </div>
    `;
    }).join('');
}

function starMarkup(rating) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return '<i class="fas fa-star"></i>'.repeat(full)
    + (half ? '<i class="fas fa-star-half-alt"></i>' : '')
    + '<i class="far fa-star"></i>'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
}

function feeValue(feeStructure) {
  return parseInt(String(feeStructure).replace(/[^0-9]/g, ''), 10) || 0;
}

function readMarketplaceFilters() {
  const selects = $$('.filter-select');
  return {
    specialization: selects[0] && selects[0].value !== 'All Specializations' ? selects[0].value : null,
    location: selects[1] && selects[1].value !== 'All Locations' ? selects[1].value : null,
    maxFee: $('.fee-slider') ? Number($('.fee-slider').value) : null,
    availableOnly: !!($('.availability-toggle input') && $('.availability-toggle input').checked),
    query: AppState.marketplaceQuery || ''
  };
}

function matchesMarketplaceFilters(lawyer, filters) {
  if (filters.availableOnly && !lawyer.availability) return false;
  if (filters.query) {
    const known = searchLawyers(filters.query, {});
    if (!known.some(entry => entry.name === lawyer.name)) return false;
  }
  if (filters.location && !String(lawyer.location).toLowerCase().includes(filters.location.toLowerCase())) return false;
  if (filters.specialization && !lawyer.specialization.some(spec =>
    spec.toLowerCase().includes(filters.specialization.toLowerCase()))) return false;
  if (filters.maxFee && feeValue(lawyer.fee_structure) > filters.maxFee) return false;
  return true;
}

function setupMarketplaceFilters() {
  const searchInput = $('.marketplace-search .search-input');
  const searchBtn = $('.search-btn');

  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      AppState.marketplaceQuery = searchInput.value.trim();
      renderLawyerCards();
    }, 250));

    if (AppState.marketplaceQuery) searchInput.value = AppState.marketplaceQuery;

    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        AppState.marketplaceQuery = searchInput.value.trim();
        renderLawyerCards();
        showToast('info', 'Search Updated', `Showing advocates matching "${AppState.marketplaceQuery || 'all'}"`);
      }
    });
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      AppState.marketplaceQuery = (searchInput && searchInput.value || '').trim();
      renderLawyerCards();
    });
  }

  $$('.filter-select').forEach(select => {
    select.addEventListener('change', () => {
      applyMarketplaceFilters();
      renderLawyerCards();
    });
  });

  const feeSlider = $('.fee-slider');
  if (feeSlider) {
    feeSlider.addEventListener('input', () => {
      const label = feeSlider.closest('.fee-range').querySelector('label');
      if (label) label.textContent = `Fee Range: ₹1000 - ₹${feeSlider.value}`;
      renderLawyerCards();
    });
  }

  const availabilityToggle = $('.availability-toggle input');
  if (availabilityToggle) {
    availabilityToggle.addEventListener('change', () => renderLawyerCards());
  }
}

function applyMarketplaceFilters() {
  const filters = readMarketplaceFilters();
  const count = DemoData.lawyers.filter(lawyer => matchesMarketplaceFilters(lawyer, filters)).length;
  showToast('info', 'Filters Applied', `${count} advocate(s) match your criteria.`);
}

function viewLawyerProfile(lawyerId) {
  showLawyerProfileModal(lawyerId);
}

function connectWithLawyer(lawyerName) {
  const lawyer = DemoData.lawyers.find(entry => entry.name === lawyerName);
  if (!lawyer) {
    showToast('error', 'Lawyer Not Found', 'That advocate is no longer listed. Please search again.');
    return;
  }

  const summaryReady = !!AppState.caseData.triagedAt;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';

  const content = document.createElement('div');
  content.className = 'modal glass-card';
  content.style.maxWidth = '500px';
  content.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">Connect with ${escapeHtml(lawyer.name)}</h3>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="modal-body">
      <p style="margin-bottom: var(--space-lg); color: var(--color-gray-400);">Share your case summary with this advocate? Typical first response: ${escapeHtml(lawyer.response_time)}.</p>
      <div style="background: rgba(90,49,244,0.05); padding: var(--space-md); border-radius: var(--radius-sm); margin-bottom: var(--space-lg);">
        <h4 style="margin-bottom: var(--space-sm);">Information to be shared</h4>
        <ul style="color: var(--color-gray-400); line-height: 1.8;">
          <li>Case summary${summaryReady ? ' (from your intake answers)' : ' (demo case - intake not completed yet)'}</li>
          <li>Case category and urgency</li>
          <li>Your contact preferences</li>
        </ul>
      </div>
      <div style="display: flex; gap: var(--space-sm);">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove();" style="flex: 1;">
          Cancel
        </button>
        <button class="btn btn-primary" onclick="confirmLawyerConnection('${escapeHtml(lawyer.name).replace(/'/g, '')}'); this.closest('.modal-overlay').remove();" style="flex: 1;">
          <i class="fas fa-check"></i> Confirm
        </button>
      </div>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

function confirmLawyerConnection(lawyerName) {
  AppState.lawyerAssignments = [lawyerName];
  AppState.caseData = Object.assign({}, AppState.caseData, { lawyer: lawyerName, status: 'With Lawyer' });
  persistState();
  updateDashboardWidgets();
  showToast('success', 'Connected', `Your summary has been prepared for ${lawyerName}. In the full product they would be notified here.`);
}

// Documents Functions
function initializeDocuments() {
  if (!AppState.documents.length) {
    AppState.documents = DemoData.documents.map(doc => Object.assign({
      extractedText: 'Sample document included with the demo case file.'
    }, doc));
  }
  renderDocuments();
  setupDocumentUpload();
}

function renderDocuments() {
  const table = $('#documentsTable');
  if (!table) return;

  // Drop previously rendered rows, keep the header row.
  table.querySelectorAll('.table-row').forEach(row => row.remove());

  if (!AppState.documents.length) {
    const empty = createElement('div', 'table-row');
    empty.style.gridColumn = '1 / -1';
    empty.innerHTML = '<div class="col-name" style="grid-column: 1 / -1; color: var(--color-gray-400); justify-content: center;">No documents yet. Upload the first one above.</div>';
    table.appendChild(empty);
    return;
  }

  AppState.documents.forEach(doc => {
    const row = createElement('div', 'table-row');
    row.dataset.docId = doc.id;
    row.innerHTML = `
      <div class="col-name">
        <i class="fas ${iconForDoc(doc.type)}"></i>
        <span>${escapeHtml(doc.name)}</span>
      </div>
      <div class="col-type"><span class="doc-type ${escapeHtml((doc.type || 'evidence').toLowerCase())}">${escapeHtml(doc.type)}</span></div>
      <div class="col-date">${escapeHtml(formatDate(doc.upload_date))}</div>
      <div class="col-size">${escapeHtml(doc.size)}</div>
      <div class="col-status">
        <span class="status-badge ${escapeHtml(statusClass(doc.status))}">${escapeHtml(doc.status)}</span>
        ${doc.status === 'Processing' ? '<div class="processing-spinner"></div>' : ''}
      </div>
      <div class="col-actions">
        ${doc.status === 'Processing'
          ? '<button class="action-btn disabled"><i class="fas fa-eye"></i></button>'
          : `<button class="action-btn" onclick="viewDocument('${escapeHtml(doc.id)}')" aria-label="Preview ${escapeHtml(doc.name)}"><i class="fas fa-eye"></i></button>`}
        <button class="action-btn" onclick="downloadDocument('${escapeHtml(doc.id)}')" aria-label="Download ${escapeHtml(doc.name)}"><i class="fas fa-download"></i></button>
        <button class="action-btn" onclick="shareDocument('${escapeHtml(doc.id)}')" aria-label="Share ${escapeHtml(doc.name)}"><i class="fas fa-share"></i></button>
        <button class="action-btn danger" onclick="deleteDocument('${escapeHtml(doc.id)}')" aria-label="Delete ${escapeHtml(doc.name)}"><i class="fas fa-trash"></i></button>
      </div>
    `;
    table.appendChild(row);
  });

  applyPIIRedaction();
  updateDashboardWidgets();
}

function iconForDoc(type) {
  return {
    Contract: 'fa-file-contract',
    Evidence: 'fa-file-shield',
    Statement: 'fa-file-word'
  }[type] || 'fa-file-pdf';
}

function statusClass(status) {
  return { Ready: 'ready', Redacted: 'redacted', Processing: 'processing' }[status] || 'processing';
}

function documentById(docId) {
  return AppState.documents.find(doc => String(doc.id) === String(docId));
}

function setupDocumentUpload() {
  const uploadArea = $('#upload-area');
  const fileInput = $('#file-input');
  const selectFilesBtn = uploadArea && uploadArea.querySelector('.btn-primary');

  if (!uploadArea || !fileInput) return;

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = 'var(--primary-color)';
    uploadArea.style.background = 'rgba(90, 49, 244, 0.1)';
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.borderColor = 'rgba(90, 49, 244, 0.3)';
    uploadArea.style.background = 'rgba(90, 49, 244, 0.05)';
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = 'rgba(90, 49, 244, 0.3)';
    uploadArea.style.background = 'rgba(90, 49, 244, 0.05)';
    handleFileUpload(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', (e) => {
    handleFileUpload(e.target.files);
    fileInput.value = '';
  });

  if (selectFilesBtn) {
    selectFilesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }
}

function handleFileUpload(files) {
  if (!files || files.length === 0) return;

  Array.from(files).forEach(file => {
    if (file.size > 10 * 1024 * 1024) {
      showToast('error', 'File Too Large', `${file.name} exceeds the 10MB limit.`);
      return;
    }

    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      showToast('error', 'Invalid File Type', `${file.name} is not a supported format.`);
      return;
    }

    showToast('info', 'Upload Started', `Processing ${file.name}...`);

    const record = {
      id: `doc_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name: file.name,
      type: mimeToType(file.type),
      upload_date: new Date().toISOString().split('T')[0],
      size: formatFileSize(file.size),
      status: 'Processing'
    };
    AppState.documents.unshift(record);
    renderDocuments();
    persistState();

    simulateDocumentUpload(file).then(result => {
      if (!result.success) {
        AppState.documents = AppState.documents.filter(doc => doc.id !== record.id);
        renderDocuments();
        persistState();
        showToast('error', 'Upload Failed', `Failed to process ${file.name}.`);
        return;
      }
      record.status = 'Ready';
      record.extractedText = extractedTextFor(record);
      renderDocuments();
      persistState();
      populateCaseSummary();
      showToast('success', 'Upload Complete', `${file.name} processed and added to your case file.`);
    });
  });
}

function mimeToType(type) {
  if (type === 'application/pdf') return 'Evidence';
  if (type === 'image/jpeg' || type === 'image/png') return 'Exhibit';
  return 'Statement';
}

function extractedTextFor(record) {
  return `Extracted text for ${record.name}. In the full product this is produced by the OCR pipeline and searched by the assistant; in this demo build the file never leaves your browser.`;
}

function viewDocument(docId) {
  const doc = documentById(docId);
  if (!doc) {
    showToast('error', 'Document Missing', 'That document is no longer in your case file.');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';

  const content = document.createElement('div');
  content.className = 'modal glass-card';
  content.style.maxWidth = '800px';
  content.style.maxHeight = '80vh';
  content.style.overflow = 'auto';
  content.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title"><i class="fas ${iconForDoc(doc.type)}" style="color: var(--primary-color); margin-right: var(--space-sm);"></i> ${escapeHtml(doc.name)}</h3>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="modal-body">
      <div style="background: rgba(0,0,0,0.02); padding: var(--space-xl); border-radius: var(--radius-md); margin-bottom: var(--space-lg);">
        <div style="display:flex; gap: var(--space-md); justify-content:center; margin-bottom: var(--space-lg); color: var(--color-gray-400); font-size:.85rem; flex-wrap:wrap;">
          <span><i class="fas fa-tag"></i> ${escapeHtml(doc.type)}</span>
          <span><i class="fas fa-calendar-day"></i> ${escapeHtml(formatDate(doc.upload_date))}</span>
          <span><i class="fas fa-weight-hanging"></i> ${escapeHtml(doc.size)}</span>
          <span><i class="fas fa-circle-check"></i> ${escapeHtml(doc.status)}</span>
        </div>
        <h4 style="margin-bottom: var(--space-md);">Extracted Text (OCR)</h4>
        <div style="background: white; padding: var(--space-lg); border-radius: var(--radius-sm); line-height: 1.8; color: var(--color-gray-400);">
          <p>${escapeHtml(doc.extractedText || 'Text has not been extracted for this document yet.')}</p>
        </div>
      </div>
      <div style="display: flex; gap: var(--space-sm);">
        <button class="btn btn-secondary" onclick="downloadDocument('${escapeHtml(doc.id)}'); this.closest('.modal-overlay').remove();" style="flex: 1;">
          <i class="fas fa-download"></i> Download
        </button>
        <button class="btn btn-primary" onclick="shareDocument('${escapeHtml(doc.id)}'); this.closest('.modal-overlay').remove();" style="flex: 1;">
          <i class="fas fa-share"></i> Share
        </button>
      </div>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

function downloadDocument(docId) {
  const doc = documentById(docId);
  if (!doc) return;

  const text = [
    `NyaySaathi case file export`,
    `${'='.repeat(40)}`,
    `Document: ${doc.name}`,
    `Type: ${doc.type}`,
    `Uploaded: ${doc.upload_date}`,
    `Size: ${doc.size}`,
    `Status: ${doc.status}`,
    ``,
    doc.extractedText || ''
  ].join('\n');

  const ext = doc.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'txt';
  downloadFile(`${doc.name}.${ext === 'pdf' ? 'summary.pdf' : 'txt'}`,
    ext === 'pdf' ? buildSimplePdf(doc.name, text.split('\n').slice(1)) : text,
    ext === 'pdf' ? 'application/pdf' : 'text/plain;charset=utf-8');
  showToast('success', 'Download Ready', `${doc.name} summary downloaded.`);
}

function shareDocument(docId) {
  const doc = documentById(docId);
  if (!doc) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';

  const token = `${doc.id}-${Date.now().toString(36)}`;
  const shareLink = `${window.location.origin}${window.location.pathname}#share/${token}`;

  const content = document.createElement('div');
  content.className = 'modal glass-card';
  content.style.maxWidth = '500px';
  content.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">Share ${escapeHtml(doc.name)}</h3>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="modal-body">
      <p style="margin-bottom: var(--space-lg); color: var(--color-gray-400);">In this demo the link only refers to data held in your browser; there is no server to fetch it from. The real product would issue an expiring, access-logged link.</p>
      <div style="background: rgba(0,0,0,0.02); padding: var(--space-md); border-radius: var(--radius-sm); margin-bottom: var(--space-md); display: flex; align-items: center; gap: var(--space-sm);">
        <input type="text" value="${escapeHtml(shareLink)}" readonly id="share-link-input" style="flex: 1; border: none; background: transparent; padding: var(--space-xs);">
        <button class="btn btn-secondary" onclick="copyShareLink()" style="padding: var(--space-xs) var(--space-md);">
          <i class="fas fa-copy"></i>
        </button>
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-sm); margin-bottom: var(--space-lg);">
        <button class="btn btn-secondary" onclick="openShareChannel('mailto:?subject=${encodeURIComponent('Case document: ' + doc.name)}'); this.closest('.modal-overlay').remove();" style="padding: var(--space-md);">
          <i class="fas fa-envelope"></i><br/><small>Email</small>
        </button>
        <button class="btn btn-secondary" onclick="openShareChannel('https://wa.me/?text=${encodeURIComponent(shareLink)}'); this.closest('.modal-overlay').remove();" style="padding: var(--space-md);">
          <i class="fab fa-whatsapp"></i><br/><small>WhatsApp</small>
        </button>
        <button class="btn btn-secondary" onclick="openShareChannel('sms:?body=${encodeURIComponent(shareLink)}'); this.closest('.modal-overlay').remove();" style="padding: var(--space-md);">
          <i class="fas fa-sms"></i><br/><small>SMS</small>
        </button>
      </div>
      <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove();" style="width: 100%;">
        Done
      </button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

function copyShareLink() {
  const input = $('#share-link-input');
  if (!input) return;
  input.select();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(input.value)
      .then(() => showToast('success', 'Copied', 'Link copied to clipboard.'))
      .catch(() => showToast('info', 'Select To Copy', 'Clipboard blocked - the link is selected, press Ctrl/Cmd+C.'));
  } else {
    showToast('info', 'Select To Copy', 'The link is selected - press Ctrl/Cmd+C.');
  }
}

function openShareChannel(href) {
  showToast('info', 'Opening Channel', 'Your app or mail client would open here.');
  try {
    window.open(href, '_blank', 'noopener');
  } catch (error) {
    console.warn('NyaySaathi: share channel unavailable', error);
  }
}

function deleteDocument(docId) {
  const doc = documentById(docId);
  if (!doc) return;

  if (!window.confirm(`Delete "${doc.name}" from your case file? This cannot be undone.`)) return;

  AppState.documents = AppState.documents.filter(entry => String(entry.id) !== String(docId));
  renderDocuments();
  persistState();
  populateCaseSummary();
  showToast('success', 'Document Deleted', `${doc.name} removed from your case file.`);
}

// Redaction is now a presentation-only class on the table: the underlying
// text is never destroyed, so the toggle can always round-trip.
function togglePIIRedaction() {
  AppState.piiRedacted = !AppState.piiRedacted;
  applyPIIRedaction();
  showToast('info', AppState.piiRedacted ? 'PII Masked' : 'PII Visible',
    AppState.piiRedacted ? 'Document names are masked on screen only.' : 'Document names are visible again.');
}

function applyPIIRedaction() {
  const table = $('#documentsTable');
  if (table) table.classList.toggle('pii-masked', AppState.piiRedacted);

  const btn = $('#piiRedactionBtn');
  if (btn) {
    btn.innerHTML = AppState.piiRedacted
      ? '<i class="fas fa-eye"></i> Show Names'
      : '<i class="fas fa-eye-slash"></i> Toggle PII Redaction';
    btn.setAttribute('aria-pressed', String(AppState.piiRedacted));
  }
}

// Analytics Functions
function initializeAnalytics() {
  renderAnalyticsCharts();
  updateKPICards();
}

function renderAnalyticsCharts() {
  // Monthly Trends Chart
  const monthlyCtx = $('#monthlyTrendsChart');
  if (monthlyCtx && !monthlyCtx.chart) {
    monthlyCtx.chart = new Chart(monthlyCtx, {
      type: 'line',
      data: {
        labels: DemoData.analytics.monthly_trends.map(item => item.month),
        datasets: [{
          label: 'Cases',
          data: DemoData.analytics.monthly_trends.map(item => item.cases),
          borderColor: '#5A31F4',
          backgroundColor: 'rgba(90, 49, 244, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(0, 0, 0, 0.1)'
            }
          },
          x: {
            grid: {
              display: false
            }
          }
        }
      }
    });
  }
  
  // Topic Distribution Chart
  const topicCtx = $('#topicDistributionChart');
  if (topicCtx && !topicCtx.chart) {
    topicCtx.chart = new Chart(topicCtx, {
      type: 'doughnut',
      data: {
        labels: DemoData.analytics.topic_distribution.map(item => item.category),
        datasets: [{
          data: DemoData.analytics.topic_distribution.map(item => item.percentage),
          backgroundColor: [
            '#5A31F4',
            '#00D1C1', 
            '#FF6B6B',
            '#FFD700',
            '#9C27B0'
          ],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom'
          }
        }
      }
    });
  }
  
  // Readiness Score Chart
  const readinessCtx = $('#readinessScoreChart');
  if (readinessCtx && !readinessCtx.chart) {
    const readinessData = {
      labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6'],
      datasets: [{
        label: 'Case Readiness Score',
        data: [25, 45, 60, 70, 75, 85],
        borderColor: '#00D1C1',
        backgroundColor: 'rgba(0, 209, 193, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4
      }]
    };
    
    readinessCtx.chart = new Chart(readinessCtx, {
      type: 'line',
      data: readinessData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            grid: {
              color: 'rgba(0, 0, 0, 0.1)'
            },
            ticks: {
              callback: function(value) {
                return value + '%';
              }
            }
          },
          x: {
            grid: {
              display: false
            }
          }
        }
      }
    });
  }
}

function updateKPICards() {
  $$('.kpi-value').forEach(element => {
    const raw = element.textContent.trim();
    const match = raw.match(/^([\d,]+)\s*(%|m|hours?|min)?/i);
    if (!match) return;
    const target = parseInt(match[1].replace(/,/g, ''), 10);
    if (Number.isNaN(target)) return;
    animateValue(element, 0, target, 1200, match[2] || '', raw.includes(','));
  });
}

function animateValue(element, start, end, duration, suffix = '', grouping = false) {
  const startTimestamp = performance.now();

  function step(timestamp) {
    const elapsed = timestamp - startTimestamp;
    const progress = Math.min(elapsed / duration, 1);
    const current = Math.floor(progress * (end - start) + start);
    element.textContent = (grouping ? current.toLocaleString('en-IN') : String(current)) + suffix;
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

// AI Insights Functions
function initializeAIInsights() {
  setupAIControls();
  updateRAGStatus();
}

function setupAIControls() {
  // Mode toggle buttons
  $$('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const mode = btn.dataset.mode;
      showToast('info', 'AI Mode Changed', `Switched to ${mode} mode.`);
    });
  });
  
  // Sensitivity slider
  const sensitivitySlider = $('.sensitivity-slider');
  if (sensitivitySlider) {
    sensitivitySlider.addEventListener('input', (e) => {
      const value = e.target.value;
      showToast('info', 'Sensitivity Updated', `AI sensitivity level set to ${value}.`);
    });
  }
}

function updateRAGStatus() {
  // Animate connection indicators
  $$('.connection-indicator').forEach((indicator, index) => {
    setTimeout(() => {
      indicator.style.animation = 'pulse 2s infinite';
    }, index * 500);
  });
}

function generateDocument() {
  const templateSelector = $('.template-selector');
  const selectedTemplate = templateSelector && templateSelector.value;

  if (!selectedTemplate || selectedTemplate === 'Select Template') {
    showToast('error', 'No Template Selected', 'Please select a document template first.');
    return;
  }

  const previewArea = $('#ai-document-preview');
  const generateBtn = $('#generateDocumentBtn');
  const undoLoading = showLoadingState(generateBtn || document.createElement('span'), 'Drafting...');

  previewArea.classList.remove('hidden');
  $('#generated-content').innerHTML = '<p style="color: var(--color-gray-400);">Drafting from your case data...</p>';

  handleAsyncOperation(new Promise(resolve => {
    setTimeout(() => resolve(documentDraftFor(selectedTemplate)), 1200);
  }), 'Generating document draft')
    .then(html => {
      undoLoading();
      $('#generated-content').innerHTML = html;
      AppState.lastGenerated = { template: selectedTemplate, html: html, at: new Date().toISOString() };
      persistState();
      showToast('success', 'Document Generated', 'Draft ready for a lawyer to review.');
    })
    .catch(() => {
      undoLoading();
      $('#generated-content').innerHTML = '<p>The draft could not be prepared. Please try again.</p>';
    });
}

// Drafts are assembled from the same triage the rest of the app uses, so the
// template text can never contradict the case summary.
function documentDraftFor(template) {
  const data = caseForDisplay();
  const knowledge = knowledgeFor(data.category);
  const statutes = knowledge.statutes.map(s => s.name).join(' read with ');
  const disclaimers = `
    <p style="font-style:italic;color:var(--color-gray-400);margin-top:var(--space-lg);">
      Draft generated by NyaySaathi from your own intake answers for ${escapeHtml(data.id)}. This is an educational
      template, not legal advice, and must be reviewed and settled by an enrolled advocate before filing.
    </p>`;

  const facts = `
    <p><strong>Case ID:</strong> ${escapeHtml(data.id)}</p>
    <p><strong>Category:</strong> ${escapeHtml(knowledge.domain)}</p>
    <p><strong>Risk / urgency:</strong> ${escapeHtml(data.risk_level)} / ${escapeHtml(data.urgency)}</p>
    <p><strong>Applicable framework:</strong> ${escapeHtml(statutes)}</p>
    <p><strong>Account of events:</strong> ${escapeHtml(data.description || 'To be completed by the deponent.')}</p>`;

  const drafts = {
    'case-summary': `<h3>Case Summary</h3>${facts}
      <p><strong>Documents on file:</strong> ${escapeHtml(AppState.documents.map(d => d.name).join(', ') || 'None yet')}</p>
      <p><strong>Recommended forum:</strong> ${escapeHtml(knowledge.recommendedForum)}</p>${disclaimers}`,
    'fir-draft': `<h3>First Information Report (Draft)</h3>
      <p><strong>To:</strong> The Station House Officer</p>
      <p><strong>Subject:</strong> Information regarding ${escapeHtml(knowledge.domain.toLowerCase())}</p>
      <p>I, [full name], son/daughter of [name], resident of [address], hereby state as follows:</p>
      <p>1. ${escapeHtml(data.description || '[Set out the incident in your own words, with dates.]')}</p>
      <p>2. The above facts disclose an offence falling within ${escapeHtml(statutes)}.</p>
      <p>3. I request that an FIR be registered and the necessary investigation commence.</p>
      <p><strong>Verified:</strong> Place: [ ] Date: ${escapeHtml(new Date().toLocaleDateString('en-IN'))}</p>${disclaimers}`,
    'notice': `<h3>Legal Notice</h3>
      <p><strong>To:</strong> [Noticee name and address]</p>
      <p><strong>Under instructions from my client</strong>, you are called upon to take notice that:</p>
      <p>1. My client's account of events: ${escapeHtml(data.description || '[to be inserted]')}</p>
      <p>2. The conduct set out above amounts to a breach of ${escapeHtml(statutes)}.</p>
      <p>3. Within 15 days of receipt my client must be paid compensation and given written assurance that the conduct will stop, failing which civil and criminal remedies will be pursued at your risk as to cost.</p>
      <p><strong>Yours faithfully</strong><br/>[Advocate name, Bar Council enrolment no.]</p>${disclaimers}`,
    'bail-grounds': `<h3>Grounds of Bail Application</h3>
      <p><strong>Before the Court of the Sessions Judge</strong></p>
      <p>1. The applicant is innocent and has been implicated in ${escapeHtml(knowledge.domain.toLowerCase())} matters.</p>
      <p>2. The alleged role, as gathered from the case diary, does not warrant custodial interrogation.</p>
      <p>3. The applicant has a fixed residence, will cooperate with the investigation and will not tamper with evidence: ${escapeHtml(AppState.documents.length + ' document(s) already placed on record')}.</p>
      <p>4. Custody would cause undue hardship to the applicant's family.</p>
      <p><strong>Prayer:</strong> Ad-interim and regular bail be granted on reasonable conditions.</p>${disclaimers}`
  };
  return drafts[template] || `<h3>${escapeHtml(template)}</h3>${facts}${disclaimers}`;
}

function editDocument() {
  const content = $('#generated-content');
  if (!content || content.classList.contains('editable')) {
    showToast('info', 'Edit Mode', 'There is no draft open to edit yet.');
    return;
  }
  content.classList.add('editable');
  content.setAttribute('contenteditable', 'true');
  content.focus();
  showToast('info', 'Edit Mode On', 'You can now edit the draft directly in the page.');
}

function downloadGenerated() {
  const content = $('#generated-content');
  if (!content || !content.textContent.trim()) {
    showToast('error', 'Nothing To Download', 'Generate a document draft first.');
    return;
  }

  const text = content.innerText.replace(/\n{3,}/g, '\n\n').trim();
  const stamp = new Date().toISOString().split('T')[0];
  downloadFile(`NyaySaathi_Draft_${stamp}.pdf`, buildSimplePdf('NyaySaathi Draft', text.split('\n')), 'application/pdf');
  showToast('success', 'Download Ready', 'Draft PDF downloaded.');
}

function editDocument() {
  showToast('info', 'Edit Mode', 'Opening document editor...');
}

function downloadGenerated() {
  showToast('info', 'Preparing Download', 'Generating PDF version...');
  
  setTimeout(() => {
    showToast('success', 'Download Ready', 'AI-generated document downloaded successfully.');
  }, 1500);
}

function initiateHandoff() {
  const scope = $('#handoffOptions') || document;
  const includeTranscript = scope.querySelector('input[type="checkbox"]');
  const activeUrgency = scope.querySelector('.urgency-btn.active');
  const urgency = activeUrgency ? activeUrgency.dataset.urgency : (AppState.caseData.urgency || 'Medium');
  const withTranscript = !!(includeTranscript && includeTranscript.checked);
  const lawyer = AppState.caseData.lawyer || AppState.lawyerAssignments[0];

  if (!AppState.caseData.triagedAt && !lawyer) {
    showToast('warning', 'Nothing To Send Yet', 'Complete the confidential intake first, or connect with an advocate.');
    return;
  }

  showToast('info', 'Initiating Handoff', `Preparing case bundle (${escapeHtml(urgency)} priority${withTranscript ? ', with transcript' : ''})...`);

  setTimeout(() => {
    const bundle = caseSummaryText();
    downloadFile(`NyaySaathi_Handoff_${AppState.caseData.id}.txt`, bundle, 'text/plain;charset=utf-8');
    AppState.caseData = Object.assign({}, AppState.caseData, {
      status: lawyer ? 'With Lawyer' : AppState.caseData.status,
      handoffAt: new Date().toISOString()
    });
    persistState();
    updateDashboardWidgets();
    showToast('success', 'Handoff Ready', lawyer
      ? `Bundle downloaded and addressed to ${lawyer}.`
      : 'Bundle downloaded. Connect with an advocate to send it.');
  }, 1500);
}

function runAutomation(type) {
  const knowledge = knowledgeFor(currentCategory());

  const builders = {
    checklist: () => ({
      title: 'Document Checklist',
      lines: knowledge.documents.map(doc => `[ ] ${doc}`)
    }),
    timeline: () => {
      const risk = riskForCurrentCase();
      const months = risk.overall >= 66 ? '9-18' : risk.overall >= 40 ? '6-12' : '3-8';
      return {
        title: 'Timeline Prediction',
        lines: knowledge.story.timeline.map(step => `${step.phase} - ${step.text}`).concat([`Overall: typically ${months} months for this risk band.`])
      };
    },
    status: () => ({
      title: 'Client Status Update',
      lines: [
        `Dear ${AppState.currentUser && AppState.currentUser.name ? AppState.currentUser.name : 'Sir/Madam'},`,
        '',
        `Your matter (${AppState.caseData.id}) is currently at "${AppState.caseData.status}".`,
        `Documents on record: ${AppState.documents.length}.`,
        `Completeness of your case file: ${caseCompleteness()}%.`,
        '',
        'Next step: ' + (nextStepItems().find(step => !step.done) || { text: 'nothing outstanding' }).text
      ]
    })
  };

  const builder = builders[type];
  if (!builder) {
    showToast('error', 'Unknown Automation', 'That automation is not available.');
    return;
  }

  showToast('info', 'Running Automation', `Executing ${type}...`);

  simulateApiDelay(() => {
    const result = builder();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal glass-card" style="max-width:560px;">
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(result.title)}</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <div style="background: rgba(0,0,0,0.02); padding: var(--space-lg); border-radius: var(--radius-sm); line-height:1.9; white-space:pre-wrap;">${escapeHtml(result.lines.join('\n'))}</div>
          <p style="margin-top:var(--space-md); color:var(--color-gray-400); font-size:.85rem;">Educational output based on your intake answers. Review with an advocate before relying on it.</p>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    showToast('success', 'Automation Complete', `${result.title} ready.`);
  }, 900);
}

// Policies Functions
function initializePolicies() {
  setupPolicySections();
}

function setupPolicySections() {
  // All policy section handlers are in the HTML onclick attributes
}

function togglePolicySection(sectionId) {
  const section = $(`#${sectionId}`);
  const header = section.previousElementSibling;
  
  if (section.classList.contains('expanded')) {
    section.classList.remove('expanded');
    header.classList.remove('expanded');
  } else {
    section.classList.add('expanded');
    header.classList.add('expanded');
  }
}

function downloadPolicy(policyType) {
  showToast('info', 'Generating PDF', `Preparing ${policyType} policy document...`);

  setTimeout(() => {
    const lines = [];
    $$('.policy-section').forEach(section => {
      const heading = section.querySelector('h3');
      if (heading) lines.push('', heading.textContent.trim());
      section.querySelectorAll('h4').forEach(sub => lines.push(`  ${sub.textContent.trim()}`));
      section.querySelectorAll('p').forEach(p => {
        const text = p.textContent.trim().replace(/\s+/g, ' ');
        if (text) lines.push(`    ${text.slice(0, 120)}`);
      });
    });

    const header = ['NyaySaathi - ' + policyType + ' policy', 'Generated ' + new Date().toLocaleString('en-IN'), ''];
    downloadFile(`nyaysaathi-${policyType}-policy.pdf`,
      buildSimplePdf('NyaySaathi ' + policyType + ' policy', header.concat(lines)),
      'application/pdf');

    showToast('success', 'Download Ready', `${policyType} policy PDF downloaded.`);
  }, 600);
}

// Settings Functions
function initializeSettings() {
  setupSettingsControls();
}

function setupSettingsControls() {
  $$('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  const fontSlider = $('.font-size-slider');
  if (fontSlider) {
    fontSlider.value = AppState.settings.fontSize || 14;
    const display = fontSlider.parentElement.querySelector('.slider-display');
    if (display) display.textContent = `${fontSlider.value}px`;

    fontSlider.addEventListener('input', (e) => {
      const size = Number(e.target.value);
      if (display) display.textContent = `${size}px`;
      document.documentElement.style.fontSize = `${size}px`;
      saveSetting('fontSize', size);
    });
  }

  // Persist each toggle against its own label so the setting survives reload.
  $$('.setting-toggle').forEach(toggle => {
    const label = toggle.closest('label');
    const key = `toggle:${(label ? label.textContent : 'setting').trim().replace(/\s+/g, ' ').toLowerCase()}`;
    toggle.dataset.settingKey = key;

    const saved = safeJsonParse(localStorage.getItem('nyaysaathi:settings:toggles'), {});
    if (Object.prototype.hasOwnProperty.call(saved, key)) toggle.checked = saved[key];

    toggle.addEventListener('change', () => {
      const all = safeJsonParse(localStorage.getItem('nyaysaathi:settings:toggles'), {});
      all[key] = toggle.checked;
      try {
        localStorage.setItem('nyaysaathi:settings:toggles', JSON.stringify(all));
      } catch (error) { /* storage unavailable - setting just will not persist */ }

      const name = label ? label.textContent.trim().split('\n').pop().trim() : 'Setting';
      if (name.toLowerCase().includes('high contrast')) {
        document.documentElement.classList.toggle('high-contrast', toggle.checked);
      }
      showToast('info', 'Setting Updated', `${name} ${toggle.checked ? 'enabled' : 'disabled'}.`);
    });
  });

  const contrastToggle = [...$$('.setting-toggle')].find(t => (t.closest('label') || { textContent: '' }).textContent.toLowerCase().includes('high contrast'));
  if (contrastToggle) document.documentElement.classList.toggle('high-contrast', contrastToggle.checked);
}

function applyTheme(theme, options = {}) {
  const root = document.documentElement;
  // Only clear a theme class we previously set, never every class on <html>.
  root.classList.remove('theme-light', 'theme-dark', 'theme-auto');
  root.classList.add(`theme-${theme}`);
  // The bundled design system reacts to this attribute for form controls.
  root.dataset.colorScheme = theme === 'auto'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;

  $$('.theme-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.theme === theme));
  saveSetting('theme', theme);

  if (!options.silent) {
    showToast('info', 'Theme Changed', `${theme.charAt(0).toUpperCase() + theme.slice(1)} theme applied.`);
  }
}

function exportUserData() {
  showToast('info', 'Preparing Export', 'Collecting your data for export...');
  
  setTimeout(() => {
    const userData = {
      exportedBy: 'NyaySaathi prototype',
      exportDate: new Date().toISOString(),
      profile: AppState.currentUser,
      caseData: AppState.caseData,
      intakeProgress: AppState.intakeProgress,
      documents: AppState.documents,
      lawyerAssignments: AppState.lawyerAssignments,
      preferences: AppState.settings
    };
    
    downloadFile(`nyaysaathi-data-${Date.now()}.json`, JSON.stringify(userData, null, 2), 'application/json');
    showToast('success', 'Data Exported', 'Your case file and preferences were downloaded as JSON.');
  }, 700);
}

function deleteAccount() {
  const phrase = window.prompt('This erases every case, document and setting saved in this browser. Type DELETE to confirm.');
  if (phrase === null) return;

  if (phrase.trim().toUpperCase() !== 'DELETE') {
    showToast('error', 'Not Confirmed', 'Type DELETE exactly to erase your data. Nothing was removed.');
    return;
  }

  clearPersistedState();
  try {
    localStorage.removeItem('nyaysaathi:settings:toggles');
    localStorage.removeItem('nyaysaathi:support');
  } catch (error) {
    console.warn('NyaySaathi: could not clear local data', error);
  }

  AppState.documents = [];
  AppState.lawyerAssignments = [];
  AppState.currentUser = null;
  AppState.intakeProgress = { step: 0, ageRange: null, category: null, description: null, completion: 0 };
  AppState.caseData = { id: 'NS-2025-001', risk_level: 'Medium', urgency: 'High', domain: 'Workplace Harassment', status: 'Not started', completion: 0, created: new Date().toISOString().split('T')[0] };

  document.getElementById('main-app').classList.add('hidden');
  document.getElementById('login-page').classList.add('active');
  document.body.classList.remove('app-active');
  document.documentElement.classList.remove('high-contrast');

  showToast('success', 'Data Erased', 'All local data has been deleted from this browser.');
}

// Help Functions
function initializeHelp() {
  setupHelpSearch();
  setupFAQHandlers();
}

function setupHelpSearch() {
  const searchInput = $('.help-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      searchHelpContent(query);
    });
  }
}

function searchHelpContent(query) {
  const faqItems = $$('.faq-item');
  
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question span').textContent.toLowerCase();
    const answer = item.querySelector('.faq-answer p').textContent.toLowerCase();
    
    if (question.includes(query) || answer.includes(query) || !query) {
      item.style.display = 'block';
    } else {
      item.style.display = 'none';
    }
  });
}

function setupFAQHandlers() {
  // FAQ handlers are set up via HTML onclick attributes
}

function toggleFAQ(faqId) {
  const answer = $(`#${faqId}`);
  const question = answer.previousElementSibling;
  
  if (answer.classList.contains('expanded')) {
    answer.classList.remove('expanded');
    question.classList.remove('expanded');
  } else {
    answer.classList.add('expanded');
    question.classList.add('expanded');
  }
}

function submitSupportRequest() {
  const form = $('#supportForm') || document;
  const subject = form.querySelector('.form-select');
  const message = form.querySelector('.form-textarea');
  const includeCase = form.querySelector('.form-checkbox input');

  if (!subject || !message) {
    showToast('error', 'Form Unavailable', 'The support form could not be found on this page.');
    return;
  }

  if (!validateForm(form)) {
    showToast('error', 'Missing Fields', 'Please complete the highlighted fields.');
    return;
  }

  if (!subject.value || subject.value === 'Select a topic') {
    showToast('error', 'Missing Subject', 'Please select a subject for your support request.');
    subject.style.borderColor = 'var(--coral-color)';
    return;
  }
  subject.style.borderColor = '';

  if (!message.value.trim()) {
    showToast('error', 'Missing Message', 'Please describe your issue or question.');
    message.style.borderColor = 'var(--coral-color)';
    message.focus();
    return;
  }
  message.style.borderColor = '';

  const payload = {
    subject: subject.value,
    message: message.value.trim().slice(0, 2000),
    includeCaseData: !!(includeCase && includeCase.checked),
    submittedAt: new Date().toISOString()
  };

  showToast('info', 'Submitting Request', 'Saving your support request...');

  setTimeout(() => {
    try {
      localStorage.setItem('nyaysaathi:support', JSON.stringify(payload));
    } catch (error) {
      console.warn('NyaySaathi: support request could not be stored', error);
    }
    showToast('success', 'Request Recorded', 'Saved locally. A real deployment would queue this for the support desk (24h response target).');

    subject.selectedIndex = 0;
    message.value = '';
    if (includeCase) includeCase.checked = false;
  }, 1200);
}

// AI Assistant Functions
function toggleAIAssistant() {
  const panel = $('#ai-chat-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  AppState.aiAssistantOpen = !AppState.aiAssistantOpen;
  if (AppState.aiAssistantOpen) {
    const input = panel.querySelector('.ai-input-mini input');
    if (input) input.focus();
  }
}

// The floating assistant used to be a decorative input. It now answers with
// the same triage engine the intake uses.
function askAssistant() {
  const panel = $('#ai-chat-panel');
  if (!panel) return;
  const input = panel.querySelector('.ai-input-mini input');
  const thread = panel.querySelector('.ai-chat-mini');
  const question = input && input.value.trim();
  if (!question) return;

  thread.insertAdjacentHTML('beforeend', `
    <div class="ai-message-mini" style="text-align:right;">
      <p style="display:inline-block;background:var(--primary-color);color:#fff;">${escapeHtml(question)}</p>
    </div>`);
  input.value = '';

  showTypingIndicator(true);
  setTimeout(() => {
    showTypingIndicator(false);
    const answer = generateAIResponse(question, AppState.intakeProgress.category);
    thread.insertAdjacentHTML('beforeend', `
      <div class="ai-message-mini"><p>${escapeHtml(answer)}</p></div>`);
    announceToScreenReader('Assistant replied');
    thread.scrollTop = thread.scrollHeight;
  }, 700);
}

// Modal Functions
// Closes the topmost dynamically injected modal, then the static overlay.
function closeModal() {
  const overlays = $$('.modal-overlay');
  const last = overlays[overlays.length - 1];
  if (last && last !== $('#modal-overlay')) {
    last.remove();
    return true;
  }

  const overlay = $('#modal-overlay');
  if (overlay) overlay.classList.add('hidden');
  return false;
}

// Language Functions
// A compact dictionary for the app shell (nav, page titles, hero, intake
// cards). untranslated strings simply stay in English, so nothing breaks when
// copy is edited.
const I18N = {
  hi: {
    'Dashboard': 'डैशबोर्ड',
    'Intake': 'जानकारी दें',
    'Story Mode': 'कहानी मोड',
    'Case Summary': 'केस सारांश',
    'Lawyers': 'वकील खोजें',
    'Documents': 'दस्तावेज़',
    'Analytics': 'विश्लेषण',
    'AI Insights': 'एआई मार्गदर्शन',
    'Policies': 'नीतियाँ',
    'Settings': 'सेटिंग्स',
    'Help': 'सहायता',
    'Compassionate AI bridge to legal clarity': 'कानूनी स्पष्टता तक एक सहानुभूतिपूर्ण एआई माध्यम',
    'User/Seeker': 'उपयोगकर्ता / आवेदक',
    'Get confidential legal guidance': 'गोपनीय कानूनी मार्गदर्शन पाएँ',
    'Lawyer': 'वकील',
    'Connect with clients in need': 'ज़रूरतमंदों से जुड़ें',
    'Quick Demo': 'तेज़ डेमो',
    'Get confidential legal guidance without judgment': 'बिना किसी आलोचना के, गोपनीय कानूनी मार्गदर्शन पाएँ',
    'Your privacy and security are our top priority': 'आपकी निजता और सुरक्षा ही हमारी सर्वोच्च प्राथमिकता है',
    'Start Confidential Chat': 'गोपनीय चैट शुरू करें',
    'Begin your legal journey with AI guidance': 'एआई मार्गदर्शन के साथ अपनी कानूनी यात्रा शुरू करें',
    'Browse Legal Stories': 'कानूनी कहानियाँ पढ़ें',
    'Learn from similar cases and outcomes': 'मिलते-जुलते केस और परिणामों से सीखें',
    'Find a Lawyer': 'वकील खोजें',
    'Connect directly with legal professionals': 'कानूनी पेशेवरों से सीधे जुड़ें',
    'Overview of your legal journey': 'आपकी कानूनी यात्रा का अवलोकन',
    'Professional document summary of your legal case': 'आपके कानूनी केस का दस्तावेज़ीय सारांश',
    'Connect with qualified legal professionals': 'योग्य कानूनी पेशेवरों से जुड़ें',
    'Document Management': 'दस्तावेज़ प्रबंधन',
    'Upload, organize, and manage your case documents': 'अपने केस के दस्तावेज़ अपलोड करें, व्यवस्थित करें और प्रबंधित करें',
    'Analytics Dashboard': 'विश्लेषण डैशबोर्ड',
    'Insights and metrics about your legal journey': 'आपकी कानूनी यात्रा से जुड़े आँकड़े और विश्लेषण',
    'Advanced AI features for legal analysis and assistance': 'कानूनी विश्लेषण और सहायता के लिए उन्नत एआई सुविधाएँ',
    'Policies & Compliance': 'नीतियाँ और अनुपालन',
    'Legal disclaimers, privacy policies, and compliance information': 'कानूनी अस्वीकरण, गोपनीयता नीति और अनुपालन जानकारी',
    'Customize your NyaySaathi experience': 'अपना न्यायसाथी अनुभव अनुकूलित करें',
    'Similar Legal Stories': 'मिलते-जुलते कानूनी केस',
    'Learn from real cases and understand potential outcomes': 'वास्तविक केस से सीखें और संभावित परिणाम समझें',
    'Help & Support': 'सहायता और मार्गदर्शन',
    'Get assistance and learn how to use NyaySaathi effectively': 'सहायता पाएँ और न्यायसाथी का प्रभावी उपयोग सीखें',
    'AI Insights & Tools': 'एआई मार्गदर्शन और उपकरण'
  }
}

const I18N_SELECTOR = [
  '.sidebar .nav-label',
  '#login-page .app-tagline',
  '#login-page .role-card h3',
  '#login-page .role-card p',
  '#login-page .btn-demo',
  '.intake-hero h1',
  '.intake-hero p',
  '.action-card h3',
  '.action-card p',
  '.page-header h1',
  '.page-header p'
].join(', ');

function applyLanguage(lang) {
  const dictionary = I18N[lang] || {};
  const nodes = $$(I18N_SELECTOR);
  const langBtns = $$('.lang-btn');

  nodes.forEach(node => {
    if (!node.dataset.enText) node.dataset.enText = node.textContent.trim();
    const english = node.dataset.enText;
    node.textContent = lang === 'en' ? english : (dictionary[english] || english);
  });

  langBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.lang === lang));
  document.documentElement.lang = lang === 'hi' ? 'hi' : 'en';
}

function switchLanguage(lang) {
  saveSetting('language', lang);
  applyLanguage(lang);
  const label = lang === 'en' ? 'English' : 'हिंदी';
  const covered = Array.from($$(I18N_SELECTOR)).filter(node => (I18N[lang] || {})[node.dataset.enText]).length;
  showToast('info', 'Language Changed',
    `${label} applied to the navigation and page headings (${covered} strings). Long-form content stays in English in this build.`);
}

// Event Listeners
function attachEventListeners() {
  // Navigation
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      if (page) {
        navigateTo(page);
      }
    });
  });
  
  // Skip-to-content is meaningful only if the main region is reachable.
  const mainContent = $('#main-content');
  if (mainContent) mainContent.setAttribute('tabindex', '-1');

  // Role cards
  $$('.role-card').forEach(card => {
    card.addEventListener('click', () => {
      const role = card.dataset.role;
      if (role) {
        selectRole(role);
      }
    });
  });
  
  // Language toggle
  $$('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.lang;
      switchLanguage(lang);
    });
  });
  
  
  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.widget-menu')) {
      $$('.widget-menu-dropdown').forEach(dropdown => {
        dropdown.classList.add('hidden');
      });
    }
  });
  
  // Floating assistant mini-chat
  const miniInput = $('.ai-input-mini input');
  if (miniInput) {
    miniInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        askAssistant();
      }
    });
    const sendBtn = $('.ai-input-mini button');
    if (sendBtn) sendBtn.addEventListener('click', askAssistant);
  }

  // Support form validation helper (fields opt in via `required`)
  const supportForm = $('#supportForm');
  if (supportForm) {
    supportForm.querySelectorAll('textarea, input').forEach(field => field.setAttribute('required', ''));
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const closed = closeModal();
      $$('.widget-menu-dropdown').forEach(dropdown => dropdown.classList.add('hidden'));
      if (!closed && AppState.aiAssistantOpen) toggleAIAssistant();
    }
  });
}

// Responsive Functions
function handleResize() {
  const sidebar = $('#sidebar');
  if (!sidebar) return;

  const isNarrow = window.innerWidth <= 1024;
  // Only act when the viewport actually crosses the breakpoint, so a user who
  // expands the sidebar on a narrow screen is not forced back shut.
  if (isNarrow === AppState.isNarrow) return;
  AppState.isNarrow = isNarrow;

  AppState.sidebarCollapsed = isNarrow;
  sidebar.classList.toggle('collapsed', isNarrow);
}

// Initialization
function initializeApp() {
  const restored = restoreState();
  if (restored && AppState.currentUser) {
    AppState.currentPage = 'dashboard';
  }

  applySettings();

  // Hide loading screen after initial load
  setTimeout(() => {
    const loadingScreen = $('#loading-screen');
    if (loadingScreen && $('#login-page').classList.contains('active')) {
      loadingScreen.style.display = 'none';
    }
  }, 800);

  attachEventListeners();

  // Handle responsive design
  window.addEventListener('resize', handleResize);
  handleResize();

  // Resume the saved session instead of dropping the user back on page one.
  if (restored && AppState.currentUser) enterApp(true);

  if (!$('#main-app').classList.contains('hidden')) {
    initializeDashboard();
  }

  console.log('NyaySaathi Application Ready!', restored ? '(restored session)' : '(fresh session)');
}

// Settings hydration + persistence
function applySettings() {
  const { theme, language, fontSize } = AppState.settings;
  applyTheme(theme, { silent: true });
  applyLanguage(language);
  if (fontSize) document.documentElement.style.fontSize = `${fontSize}px`;
}

function saveSetting(key, value) {
  AppState.settings[key] = value;
  persistState();
}

// Advanced features (upload simulation, triage helpers)

// Document Upload Simulation
function simulateDocumentUpload(file) {
  return new Promise((resolve) => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 20;

      AppState.documents.forEach(doc => {
        if (doc.name !== file.name || doc.status !== 'Processing') return;
        const row = $(`.table-row[data-doc-id="${doc.id}"]`);
        if (!row) return;
        let bar = row.querySelector('.upload-progress');
        if (!bar) {
          bar = createElement('div', 'upload-progress');
          bar.innerHTML = '<div class="upload-progress-fill"></div>';
          row.querySelector('.col-status').appendChild(bar);
        }
        bar.querySelector('.upload-progress-fill').style.width = `${Math.min(progress, 100)}%`;
      });

      if (progress >= 100) {
        clearInterval(interval);
        resolve({
          success: true,
          fileId: `doc_${Date.now()}`,
          name: file.name,
          size: file.size,
          type: file.type
        });
      }
    }, 180);
  });
}

// AI Response Generation Simulation
function generateAIResponse(userInput, category) {
  const knowledge = knowledgeFor(category || AppState.intakeProgress.category);
  const text = String(userInput || '');

  // Evidence the person already has vs. evidence still missing.
  const evidencePattern = /\b(email|emai?l|witness|photo|photo|record|screenshot|message|chat|medical|receipt|invoice|contract|report|fir)\w*/i;
  const hasEvidence = evidencePattern.test(text);
  const months = monthsMentioned(text);
  const urgent = /\b(threat|hurt|danger|immediately|urgent|today|scare|blackmail)\w*/i.test(text);

  const parts = [];

  if (urgent) {
    parts.push('Because you mentioned threats or immediate danger, please contact the police on 100 or the women helpline on 1091 first — your safety comes before any legal process.');
  }
  if (months >= 1) {
    parts.push(`A pattern repeating over about ${months} month${months === 1 ? '' : 's'} is legally significant: continuing conduct is usually taken more seriously than a single incident.`);
  }
  parts.push(hasEvidence
    ? `You appear to have some supporting material. Preserve originals (do not edit them), keep them backed up somewhere only you can access, and note the date of each item.`
    : `The most useful next step is to start a written record: dates, times, what happened, who saw it. Save any messages or emails as they are.`);
  parts.push(`For matters like this, the framework usually applied is ${knowledge.statutes.map(s => s.name).join(' and ')}. I can prepare a summary you can take to a lawyer, which avoids paying for a first consultation on background alone.`);

  return parts.join(' ');
}

// Risk Assessment Calculation
// Deterministic so the dashboard, story mode and export always agree.
function calculateRiskAssessment(caseData = {}) {
  const base = typeof caseData.baseRisk === 'number' ? caseData.baseRisk : 45;
  const factors = {
    legalComplexity: Math.min(100, Math.max(0, base)),
    evidenceQuality: caseData.hasEvidence ? 70 : 25,
    timelineUrgency: caseData.urgencyWords ? 85 : (caseData.documentedForMonths >= 3 ? 60 : 40),
    oppositionStrength: caseData.minorOrElderly ? 60 : 45
  };

  const values = Object.values(factors);
  const averageRisk = values.reduce((a, b) => a + b, 0) / values.length;

  return {
    overall: averageRisk,
    factors: factors,
    level: averageRisk < 33 ? 'Low' : averageRisk < 66 ? 'Medium' : 'High'
  };
}

// Lawyer Matching Algorithm
function matchLawyers(caseData = {}, preferences = {}) {
  const wanted = (caseData.specialities || []).map(s => String(s).toLowerCase());
  const domain = String(caseData.domain || '').toLowerCase();

  const scoreLawyer = lawyer => {
    let score = lawyer.rating * 10;
    const specs = (lawyer.specialization || []).map(s => s.toLowerCase());
    const overlap = specs.filter(s => wanted.some(w => s.includes(w) || w.includes(s))).length;
    score += overlap * 25;
    if (domain && specs.some(s => domain.includes(s))) score += 15;
    if (!lawyer.availability) score -= 20;
    if (preferences.availableOnly && !lawyer.availability) return -Infinity;
    return score;
  };

  return DemoData.lawyers
    .filter(lawyer => {
      if (preferences.availableOnly && !lawyer.availability) return false;
      if (preferences.location && !String(lawyer.location).toLowerCase().includes(String(preferences.location).toLowerCase())) return false;
      return true;
    })
    .map(lawyer => ({ ...lawyer, matchScore: scoreLawyer(lawyer) }))
    .filter(lawyer => Number.isFinite(lawyer.matchScore))
    .sort((a, b) => b.matchScore - a.matchScore);
}

// Case Progress Tracking
function updateCaseProgress(caseId, newStatus, completion) {
  const known = DemoData.cases.find(entry => entry.id === caseId);
  if (known) {
    known.status = newStatus;
    known.completion = completion;
  }
  if (AppState.caseData.id === caseId) {
    AppState.caseData.status = newStatus;
    AppState.caseData.completion = completion;
  }
  updateDashboardWidgets();
  persistState();
  return true;
}



// Search and Filter Functions
function searchLawyers(query, filters = {}) {
  return DemoData.lawyers.filter(lawyer => {
    const needle = String(query || '').toLowerCase().trim();
    const matchesQuery = !needle ||
      lawyer.name.toLowerCase().includes(needle) ||
      lawyer.specialization.some(spec => spec.toLowerCase().includes(needle)) ||
      lawyer.location.toLowerCase().includes(needle);

    // Filter by specialization
    const matchesSpecialization = !filters.specialization ||
      lawyer.specialization.includes(filters.specialization);
    
    // Filter by rating
    const matchesRating = !filters.minRating ||
      lawyer.rating >= filters.minRating;
    
    // Filter by fee range
    const matchesFee = !filters.maxFee ||
      parseInt(lawyer.fee_structure.replace(/[^0-9]/g, '')) <= filters.maxFee;
    
    return matchesQuery && matchesSpecialization && matchesRating && matchesFee;
  });
}

// Export Functions
function caseSummaryText() {
  const data = caseForDisplay();
  const knowledge = knowledgeFor(data.category);
  const risk = riskForCurrentCase();
  const line = (label, value) => `${(label + ':').padEnd(22)}${value}`;

  return [
    'NYAYSAATHI CASE SUMMARY',
    '='.repeat(64),
    line('Case ID', data.id),
    line('Generated', new Date().toLocaleString('en-IN')),
    line('Category', knowledge.domain),
    line('Risk level', `${data.risk_level} (score ${Math.round(risk.overall)}/100)`),
    line('Urgency', data.urgency),
    line('Status', data.status),
    line('Age range', data.ageRange || 'Not provided'),
    '',
    '='.repeat(64),
    'SITUATION AS DESCRIBED',
    '='.repeat(64),
    wrapText(data.description || 'No description captured yet.'),
    '',
    '='.repeat(64),
    'LEGAL FRAMEWORK',
    '='.repeat(64),
    ...knowledge.statutes.map(statute => `- ${statute.name}\n  ${statute.description}\n  (source last reviewed ${statute.lastUpdated})`),
    '',
    line('Recommended forum', knowledge.recommendedForum),
    '',
    '='.repeat(64),
    'EVIDENCE CHECKLIST',
    '='.repeat(64),
    ...knowledge.documents.map(doc => `[ ] ${doc}`),
    '',
    '='.repeat(64),
    'CASE GOALS',
    '='.repeat(64),
    ...knowledge.goals.map(goal => `- ${goal.text}`),
    '',
    '='.repeat(64),
    'RISK FACTORS',
    '='.repeat(64),
    ...Object.entries(risk.factors).map(([key, value]) => line(factorLabel(key), `${Math.round(value)}/100 (${levelFor(value)})`)),
    '',
    '='.repeat(64),
    `DOCUMENTS ON FILE (${AppState.documents.length})`,
    '='.repeat(64),
    ...(AppState.documents.length
      ? AppState.documents.map(doc => `- ${doc.name} | ${doc.type} | ${doc.status} | ${doc.upload_date}`)
      : ['- None uploaded yet']),
    '',
    AppState.lawyerAssignments.length ? line('Connected advocate', AppState.lawyerAssignments.join(', ')) : '',
    '',
    '='.repeat(64),
    'DISCLAIMER',
    '='.repeat(64),
    wrapText('This document is educational and does not constitute legal advice. No lawyer-client relationship is created by NyaySaathi. Timelines and outcomes shown are typical patterns, not predictions. Verify every statutory reference with a qualified advocate before filing.'),
    '',
    'Generated by NyaySaathi (prototype build)'
  ].filter(Boolean).join('\n');
}

function wrapText(text, width = 72) {
  return String(text).split(/\s+/).reduce((lines, word) => {
    const last = lines[lines.length - 1];
    if (last && (last.length + word.length + 1) <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
    return lines;
  }, ['']).join('\n');
}

function exportCaseSummary(format = 'pdf') {
  const content = caseSummaryText();
  const stamp = new Date().toISOString().split('T')[0];
  const base = `NyaySaathi_Case_Summary_${AppState.caseData.id}_${stamp}`;

  showToast('info', 'Generating Export', `Preparing case summary as ${format.toUpperCase()}...`);

  setTimeout(() => {
    if (format === 'txt' || format === 'md') {
      downloadFile(`${base}.${format}`, content, 'text/plain;charset=utf-8');
    } else if (format === 'csv') {
      const rows = content.split('\n').filter(Boolean).map(line => `"${line.replace(/"/g, '""')}"`);
      downloadFile(`${base}.csv`, rows.join('\n'), 'text/csv;charset=utf-8');
    } else {
      downloadFile(`${base}.pdf`, buildSimplePdf('NyaySaathi Case Summary', content.split('\n')), 'application/pdf');
    }
    showToast('success', 'Export Ready', `Case summary downloaded as ${format.toUpperCase()}.`);
  }, 600);
}

// Accessibility Functions
function initializeAccessibility() {
  // Focus rings only for keyboard users.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') document.body.classList.add('keyboard-navigation');
  });
  document.addEventListener('mousedown', () => {
    document.body.classList.remove('keyboard-navigation');
  });

  if (!$('#liveRegion')) {
    const region = createElement('div', 'sr-only');
    region.id = 'liveRegion';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.appendChild(region);
  }
}

function announceToScreenReader(message) {
  const region = $('#liveRegion');
  if (!region) return;
  region.textContent = '';
  setTimeout(() => { region.textContent = String(message); }, 30);
}

// Performance Monitoring
function initializePerformanceMonitoring() {
  // Monitor page load times
  window.addEventListener('load', () => {
    const loadTime = performance.now();
    console.log(`Page loaded in ${loadTime.toFixed(2)}ms`);
  });
  
  // Monitor navigation times
  const originalNavigateTo = navigateTo;
  navigateTo = function(pageName) {
    const startTime = performance.now();
    originalNavigateTo(pageName);
    const endTime = performance.now();
    console.log(`Navigation to ${pageName} took ${(endTime - startTime).toFixed(2)}ms`);
  };
}

// Error Handling
function setupErrorHandling() {
  window.addEventListener('error', (e) => {
    console.error('Application Error:', e.error);
    showToast('error', 'System Error', 'An unexpected error occurred. Please try again.');
  });
  
  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled Promise Rejection:', e.reason);
    showToast('error', 'Connection Error', 'Failed to connect to service. Please check your connection.');
  });
}

// Start the application when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    initializeAccessibility();
    initializePerformanceMonitoring();
    setupErrorHandling();
  });
} else {
  initializeApp();
  initializeAccessibility();
  initializePerformanceMonitoring();
  setupErrorHandling();
}

// Dashboard widget customisation
const WIDGET_LABELS = {
  'case-status': { name: 'Case Status', icon: 'fa-folder-open', blurb: 'Progress through your matter' },
  'next-steps': { name: 'Next Steps', icon: 'fa-list-check', blurb: 'What to do next' },
  'documents': { name: 'Document Progress', icon: 'fa-folder', blurb: 'Uploads and processing' },
  'lawyer-response': { name: 'Lawyer Response Time', icon: 'fa-chart-line', blurb: 'Response trend' },
  'risk-assessment': { name: 'Risk Assessment', icon: 'fa-gauge-high', blurb: 'Case risk factors' },
  'topic-heatmap': { name: 'Legal Topic Heatmap', icon: 'fa-table-cells', blurb: 'Topic distribution' }
};

function showAddWidgetModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';

  const content = document.createElement('div');
  content.className = 'modal glass-card';
  content.style.maxWidth = '600px';
  content.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">Dashboard Widgets</h3>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="modal-body">
      <p style="color: var(--color-gray-400); margin-bottom: var(--space-md);">Turn widgets on or off. Your choice is saved in this browser.</p>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-md);">
        ${Object.entries(WIDGET_LABELS).map(([id, meta]) => {
          const on = AppState.widgets[id] !== undefined ? AppState.widgets[id].visible : true;
          return `
          <label class="widget-option" style="display:flex;align-items:center;gap:var(--space-md);padding:var(--space-md);border:1px solid rgba(0,0,0,0.1);border-radius:var(--radius-md);cursor:pointer;">
            <input type="checkbox" ${on ? 'checked' : ''} onchange="setWidgetVisible('${id}', this.checked)" style="width:auto;">
            <i class="fas ${meta.icon}" style="color: var(--primary-color); font-size: 1.15rem;"></i>
            <span><strong>${meta.name}</strong><br><small style="color:var(--color-gray-400)">${meta.blurb}</small></span>
          </label>`;
        }).join('')}
      </div>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

function setWidgetVisible(widgetId, visible) {
  AppState.widgets[widgetId] = AppState.widgets[widgetId] || { visible: true, position: 1 };
  AppState.widgets[widgetId].visible = !!visible;
  persistState();
  applyWidgetVisibility();
  showToast('success', visible ? 'Widget Shown' : 'Widget Hidden', `${WIDGET_LABELS[widgetId] ? WIDGET_LABELS[widgetId].name : widgetId} updated.`);
}

function toggleWidgetVisibility(widgetId) {
  const current = AppState.widgets[widgetId] ? AppState.widgets[widgetId].visible : true;
  setWidgetVisible(widgetId, !current);
  $$('.widget-menu-dropdown').forEach(dropdown => dropdown.classList.add('hidden'));
}

function applyWidgetVisibility() {
  Object.entries(AppState.widgets).forEach(([widgetId, config]) => {
    const el = $(`.widget[data-widget="${widgetId}"]`);
    if (el) el.style.display = config.visible === false ? 'none' : '';
  });
}

// Lawyer Profile Modal
function showLawyerProfileModal(lawyerName) {
  const lawyer = DemoData.lawyers.find(entry => entry.name === lawyerName) || DemoData.lawyers[0];
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';

  const content = document.createElement('div');
  content.className = 'modal glass-card';
  content.style.maxWidth = '700px';
  content.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">Lawyer Profile</h3>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="modal-body">
      <div style="text-align: center; margin-bottom: var(--space-xl);">
        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='%235A31F4'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E" alt="" style="width: 100px; height: 100px; border-radius: 50%; margin-bottom: var(--space-md);">
        <h3>${escapeHtml(lawyer.name)}</h3>
        <p style="color: var(--color-gray-400);">${escapeHtml(lawyer.specialization.join(' \u00b7 '))}</p>
        <div style="display: flex; justify-content: center; gap: var(--space-md); margin-top: var(--space-md); flex-wrap: wrap;">
          <span style="background: rgba(0,209,193,0.1); padding: var(--space-xs) var(--space-md); border-radius: var(--radius-full); color: var(--accent-color); font-weight: 600;">${lawyer.rating} rating</span>
          <span style="background: rgba(90,49,244,0.1); padding: var(--space-xs) var(--space-md); border-radius: var(--radius-full); color: var(--primary-color); font-weight: 600;">${lawyer.cases_won} cases handled</span>
          <span style="background: rgba(255,107,107,0.1); padding: var(--space-xs) var(--space-md); border-radius: var(--radius-full); color: var(--coral-color); font-weight: 600;">${escapeHtml(lawyer.availability ? 'Available now' : 'Currently offline')}</span>
        </div>
      </div>
      <div style="margin-bottom: var(--space-lg);">
        <h4>Practice</h4>
        <p style="color: var(--color-gray-400); line-height: 1.6;">${escapeHtml(lawyer.name)} works on ${escapeHtml(lawyer.specialization.join(', ').toLowerCase())} matters and typically replies within ${escapeHtml(lawyer.response_time)}. Indicative fee: ₹${feeValue(lawyer.fee_structure)} per consultation.</p>
      </div>
      <div style="margin-bottom: var(--space-lg);">
        <h4>Details</h4>
        <ul style="color: var(--color-gray-400); line-height: 1.8;">
          <li>Location: ${escapeHtml(lawyer.location)}</li>
          <li>Languages: ${escapeHtml(lawyer.languages.join(', '))}</li>
          <li>Verification: Bar Council enrolment (demo record - not live-verified)</li>
        </ul>
      </div>
      <div class="educational-disclaimer" style="margin-bottom: var(--space-lg);">
        <i class="fas fa-info-circle"></i>
        <span>Profiles in this prototype are fictional sample data used to demonstrate the interface.</span>
      </div>
      <button class="btn btn-primary" ${lawyer.availability ? '' : 'disabled style="width:100%; opacity:.6; cursor:not-allowed;"'}
        onclick="${lawyer.availability ? `connectWithLawyer('${escapeHtml(lawyer.name)}'); this.closest('.modal-overlay').remove();` : ''}"
        style="width: 100%;${lawyer.availability ? '' : ' opacity:.6; cursor:not-allowed;'}">
        <i class="fas fa-user-plus"></i> ${lawyer.availability ? 'Connect Now' : 'Unavailable'}
      </button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

// Chat/Message Lawyer Modal
function showMessageLawyerModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';
  
  const content = document.createElement('div');
  content.className = 'modal glass-card';
  content.style.maxWidth = '600px';
  content.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">Message Lawyer</h3>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-group" style="margin-bottom: var(--space-md);">
        <label style="display: block; margin-bottom: var(--space-sm); font-weight: 500;">Select Lawyer</label>
        <select class="form-select" style="width: 100%; padding: var(--space-sm) var(--space-md); border: 1px solid rgba(0,0,0,0.2); border-radius: var(--radius-sm);">
          <option>Advocate Priya Sharma</option>
          <option>Advocate Rajesh Kumar</option>
          <option>Advocate Meena Patel</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom: var(--space-md);">
        <label style="display: block; margin-bottom: var(--space-sm); font-weight: 500;">Subject</label>
        <input type="text" placeholder="Brief subject of inquiry" style="width: 100%; padding: var(--space-sm) var(--space-md); border: 1px solid rgba(0,0,0,0.2); border-radius: var(--radius-sm);">
      </div>
      <div class="form-group" style="margin-bottom: var(--space-lg);">
        <label style="display: block; margin-bottom: var(--space-sm); font-weight: 500;">Message</label>
        <textarea rows="5" placeholder="Your message..." style="width: 100%; padding: var(--space-sm) var(--space-md); border: 1px solid rgba(0,0,0,0.2); border-radius: var(--radius-sm); font-family: var(--font-family-body);"></textarea>
      </div>
      <button class="btn btn-primary" onclick="showToast('success', 'Message Sent', 'Your message has been sent to the lawyer.'); this.closest('.modal-overlay').remove();" style="width: 100%;">
        <i class="fas fa-paper-plane"></i> Send Message
      </button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// File Upload Modal
function showUploadModal() {
  $('#file-input').click();
}

// Global functions for HTML onclick handlers
window.startDemo = startDemo;
window.showNotifications = showNotifications;
window.selectRole = selectRole;
window.showAddWidgetModal = showAddWidgetModal;
window.showLawyerProfileModal = showLawyerProfileModal;
window.showMessageLawyerModal = showMessageLawyerModal;
window.showUploadModal = showUploadModal;
window.toggleSidebar = toggleSidebar;
window.navigateTo = navigateTo;
window.toggleWidgetMenu = toggleWidgetMenu;
window.exportWidget = exportWidget;
window.toggleFAB = toggleFAB;
window.startIntake = startIntake;
window.selectAgeRange = selectAgeRange;
window.selectCategory = selectCategory;
window.handleChatInput = handleChatInput;
window.sendMessage = sendMessage;
window.toggleVoiceInput = toggleVoiceInput;
window.nextOutcome = nextOutcome;
window.previousOutcome = previousOutcome;
window.toggleSection = toggleSection;
window.toggleAIAssistant = toggleAIAssistant;
window.closeModal = closeModal;
window.switchLanguage = switchLanguage;

// Case Summary functions
window.switchCaseTab = switchCaseTab;
window.editCase = editCase;
window.exportCaseSummary = exportCaseSummary;

// Marketplace functions
window.viewLawyerProfile = viewLawyerProfile;
window.connectWithLawyer = connectWithLawyer;

// Document functions
window.viewDocument = viewDocument;
window.downloadDocument = downloadDocument;
window.shareDocument = shareDocument;
window.deleteDocument = deleteDocument;
window.setWidgetVisible = setWidgetVisible;
window.toggleWidgetVisibility = toggleWidgetVisibility;
window.togglePIIRedaction = togglePIIRedaction;

// AI Insights functions
window.generateDocument = generateDocument;
window.editDocument = editDocument;
window.downloadGenerated = downloadGenerated;
window.initiateHandoff = initiateHandoff;
window.runAutomation = runAutomation;

// Policies functions
window.togglePolicySection = togglePolicySection;
window.downloadPolicy = downloadPolicy;

// Settings functions
window.exportUserData = exportUserData;
window.deleteAccount = deleteAccount;

// Help functions
window.toggleFAQ = toggleFAQ;
window.submitSupportRequest = submitSupportRequest;

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AppState,
    DemoData,
    LegalKnowledge,
    navigateTo,
    showToast,
    calculateRiskAssessment,
    matchLawyers,
    searchLawyers,
    triageIntake,
    knowledgeFor,
    caseSummaryText,
    buildSimplePdf,
    escapeHtml,
    persistState,
    restoreState,
    STORAGE_KEY
  };
}