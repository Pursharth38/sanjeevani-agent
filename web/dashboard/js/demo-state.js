/* Sanjeevani dashboard — demo state.
   One state object drives the whole page (dashboard.md §10).
   scenario(0) is the default overview snapshot; scenario(1..8) are the Shift+D story steps.
   Works in the browser (window.SanjeevaniDemo) and in Node (module.exports) so data/state.json
   can be regenerated with:  node js/demo-state.js > data/state.json */
(function (root) {
  'use strict';

  const clone = (o) => JSON.parse(JSON.stringify(o));

  const STEPS = [
    { n: 0, title: 'Overview snapshot', note: 'The default state from the spec' },
    { n: 1, title: 'Normal day', note: 'All good · Amlodipine at 4 days' },
    { n: 2, title: 'Caregiver boards a flight', note: "I'm away on · Rohan is backup" },
    { n: 3, title: 'Stock hits 3 days', note: 'Out soon · you are told first' },
    { n: 4, title: 'No STOP, reorder placed', note: 'Paid via mandate' },
    { n: 5, title: 'New prescription arrives', note: 'Sent to Rohan to decide' },
    { n: 6, title: 'Rohan approves', note: 'Handled by Rohan' },
    { n: 7, title: 'Delivered', note: 'Maa told by voice note' },
    { n: 8, title: 'She lands', note: 'Away off · summary' }
  ];

  /* ---------------- Members ---------------- */
  function members() {
    return [
      {
        id: 'maa', name: 'Maa', tab: 'Maa', full: 'Sunita Sharma', age: 68, sex: 'F', city: 'Lucknow', initials: 'M',
        abha: '91-••••-••••-4821', abhaLinked: true, lang: 'Hindi', allergies: 'None recorded',
        medicines: [
          { id: 'telma', name: 'Telmisartan 40mg', freq: 'once daily', days: 24, pharmacy: 'Apollo Pharmacy', next: { kind: 'auto', text: 'Reorders automatically in 17 days' }, confirmed: 'delivery, 9 Sep' },
          { id: 'metf', name: 'Metformin 1000mg', freq: 'twice daily', days: 11, pharmacy: 'Apollo Pharmacy', next: { kind: 'auto', text: 'Reorders automatically in 4 days' }, confirmed: 'delivery, 22 Sep' },
          { id: 'amlo', name: 'Amlodipine 5mg', freq: 'once daily', days: 3, pharmacy: 'Apollo Pharmacy', next: { kind: 'placed', text: 'Reorder placed today · arriving Thu' }, confirmed: 'delivery, 2 Sep' }
        ],
        trends: [
          { id: 'hba1c', metric: 'HbA1c', unit: '%', band: [6.5, 7.0], dates: ['12 Jan', '20 Mar', '28 May', '30 Jul', '28 Sep'], values: [6.8, 6.9, 7.1, 7.2, 7.4], display: '7.4 %', dir: 'up', last: '28 Sep', flag: '3 readings rising — mention to Dr. Mehta' },
          { id: 'bp', metric: 'BP', unit: 'mmHg', band: [120, 135], dates: ['29 Sep', '30 Sep', '1 Oct', '2 Oct', 'Today'], values: [128, 131, 130, 133, 132], labels: ['128/82', '131/84', '130/83', '133/85', '132/84'], display: '132/84', dir: 'flat', last: 'today', status: 'Stable' },
          { id: 'creat', metric: 'Creatinine', unit: 'mg/dL', band: [0.6, 1.1], dates: ['10 Feb', '15 May', '12 Aug'], values: [0.9, 0.9, 0.9], display: '0.9', dir: 'flat', last: '12 Aug', flag: 'Test due — last done 7 weeks ago' }
        ],
        appt: { doctor: 'Dr. Mehta', spec: 'Cardiology', date: '12 Oct', time: '11:00', status: 'good', word: 'Confirmed' },
        lastTest: { text: 'HbA1c 7.4', kind: 'warn', date: '28 Sep' },
        lastRefill: { where: 'Apollo Pharmacy', when: 'Fri 2 Oct' },
        kpi: { missed: 0, days: 21, nextReorder: 'Metformin, Wed' },
        visits: ['12 Sep · Dr. Mehta, Cardiology · BP review', '28 Aug · Dr. Rao, General Medicine · Diabetes follow-up', '4 Jun · Sahara Hospital · Discharged after 2-day observation']
      },
      {
        id: 'papa', name: 'Papa', tab: 'Papa', full: 'Ramesh Sharma', age: 72, sex: 'M', city: 'Lucknow', initials: 'P',
        abha: null, abhaLinked: false, lang: 'Hindi', allergies: 'Sulfa drugs (from family)',
        medicines: [
          { id: 'meto', name: 'Metoprolol 25mg', freq: 'once daily', days: 19, pharmacy: 'Apollo Pharmacy', next: { kind: 'auto', text: 'Reorders automatically in 12 days' }, confirmed: 'delivery, 14 Sep' },
          { id: 'glim', name: 'Glimepiride 1mg', freq: 'once daily', days: 14, pharmacy: 'Apollo Pharmacy', next: { kind: 'auto', text: 'Reorders automatically in 7 days' }, confirmed: 'delivery, 19 Sep' }
        ],
        trends: [
          { id: 'fbs', metric: 'Fasting sugar', unit: 'mg/dL', band: [80, 130], dates: ['2 Sep', '9 Sep', '16 Sep', '23 Sep', '30 Sep'], values: [118, 124, 121, 126, 122], display: '122', dir: 'flat', last: '30 Sep', status: 'Stable' },
          { id: 'bp2', metric: 'BP', unit: 'mmHg', band: [120, 140], dates: ['29 Sep', '30 Sep', '1 Oct', '2 Oct', 'Today'], values: [136, 138, 137, 139, 138], labels: ['136/86', '138/88', '137/86', '139/88', '138/86'], display: '138/86', dir: 'flat', last: 'today', status: 'Stable' }
        ],
        appt: { doctor: 'Dr. Rao', spec: 'General Medicine', date: '16 Oct', time: '10:30', status: 'neutral', word: 'Waiting' },
        lastTest: { text: 'Fasting sugar 122', kind: 'good', date: '30 Sep' },
        lastRefill: { where: 'Apollo Pharmacy', when: 'Sat 19 Sep' },
        kpi: { missed: 0, days: 14, nextReorder: 'Glimepiride, Sat 10' },
        visits: ['30 Sep · Dr. Rao, General Medicine · New prescription']
      },
      {
        id: 'mummyji', name: 'Mummy-ji', tab: 'Mummy-ji', full: 'Kamla Verma', age: 70, sex: 'F', city: 'Kanpur', initials: 'MJ',
        abha: null, abhaLinked: false, lang: 'Hindi', allergies: 'None recorded',
        medicines: [
          { id: 'levo', name: 'Levothyroxine 50mcg', freq: 'once daily', days: 26, pharmacy: 'Kanpur Medicos', next: { kind: 'auto', text: 'Reorders automatically in 19 days' }, confirmed: 'delivery, 7 Sep' },
          { id: 'calc', name: 'Calcium + D3', freq: 'once daily', days: 9, pharmacy: 'Kanpur Medicos', next: { kind: 'auto', text: 'Reorders automatically in 2 days' }, confirmed: null, stale: '30 Sep' }
        ],
        trends: [
          { id: 'tsh', metric: 'TSH', unit: 'mIU/L', band: [0.5, 4.5], dates: ['14 Feb', '20 May', '25 Aug'], values: [3.4, 3.1, 2.9], display: '2.9', dir: 'down', last: '25 Aug', status: 'Stable' }
        ],
        appt: null,
        lastTest: { text: 'TSH 2.9', kind: 'good', date: '25 Aug' },
        lastRefill: { where: 'Kanpur Medicos', when: 'Wed 30 Sep' },
        kpi: { missed: 0, days: 9, nextReorder: 'Calcium + D3, Mon' },
        visits: ['25 Aug · Dr. Verma, Endocrinology · Thyroid review']
      },
      {
        id: 'anya', name: 'Anya', tab: 'Anya (daughter)', full: 'Anya Sharma', age: 9, sex: 'F', city: 'Bengaluru', initials: 'A',
        abha: null, abhaLinked: false, lang: 'English', allergies: 'Peanuts',
        medicines: [],
        trends: [],
        appt: null,
        lastTest: null,
        lastRefill: null,
        kpi: { missed: 0, days: null, nextReorder: 'No regular medicines' },
        visits: ['14 Aug · Dr. Kulkarni, Paediatrics · Annual check-up']
      }
    ];
  }

  /* ---------------- Activity rows ---------------- */
  const A = {
    voiceEta: { id: 'a-voice-eta', member: 'maa', icon: 'voice', cat: 'medicine', week: true, tag: 'sanjeevani', time: 'Today 2:05pm',
      text: 'Maa was told her medicine arrives Thursday',
      sub: "Voice note, Hindi · ● Acknowledged: 'theek hai'",
      detail: { trigger: 'Amlodipine shipped for Maa', did: ['Gnani recorded an 18-second voice note in Hindi', "Sent to Maa's WhatsApp at 14:05", "Maa replied 'theek hai' at 14:09"], window: 'Outcome only — Maa is never asked to decide anything', proof: ['wamid.HBgM…4F2'] } },
    shipped: { id: 'a-shipped', member: 'maa', icon: 'truck', cat: 'medicine', week: true, tag: 'sanjeevani', time: 'Today 1:40pm',
      text: 'Amlodipine shipped via local partner (Lucknow)',
      sub: 'Picked up from Apollo Pharmacy, Gomti Nagar · arriving Thu',
      detail: { trigger: 'Payment confirmed', did: ['No same-week Delhivery slot for pincode 226010', 'Routed to local partner · Tier-2', 'Pickup confirmed at 13:40'], window: 'Within your limits · no approval needed', proof: ['Waybill LKO-LP-20931'] } },
    paid: { id: 'a-paid', member: 'maa', icon: 'card', cat: 'medicine', week: true, tag: 'sanjeevani', time: 'Today 10:13am',
      text: '₹184 paid to Apollo Pharmacy',
      sub: 'Pine Labs mandate · ₹1,816 left this month',
      detail: { trigger: 'Apollo confirmed stock', did: ['Checked ₹184 against your ₹3,000 monthly cap', 'Pine Labs UPI AutoPay debit at 10:13'], window: 'Inside your mandate · anything above it comes to you first', proof: ['Pine Labs txn PL-UPI-77120458'], undo: 'Request refund' } },
    reorder: { id: 'a-reorder', member: 'maa', icon: 'pill', cat: 'medicine', week: true, tag: 'sanjeevani', time: 'Today 10:12am',
      text: "Reordered Maa's Amlodipine from Apollo Pharmacy",
      sub: 'You were told at 09:58 · no STOP received · ₹184 via mandate',
      detail: { trigger: 'Stock hit 3 days', did: ['Gnani call to Apollo Pharmacy · stock confirmed (10:11)', 'Pine Labs debit ₹184 (10:13)', 'Local partner pickup booked'], window: 'Told you 09:58 · 10-min STOP window · no reply', proof: ['Order APL-LKO-55812'], undo: 'Undo order (until dispatch)' } },
    readRx: { id: 'a-readrx', member: 'maa', icon: 'file', cat: 'record', week: true, tag: 'asked', time: 'Yesterday',
      text: "Read Dr. Mehta's prescription · 1 name confirmed by you",
      sub: "'Amlodipine' or 'Amlokind'? You picked Amlodipine",
      detail: { trigger: 'Photo shared in the family WhatsApp group', did: ['Read 3 medicines from handwriting', 'One name below 70% confidence — asked you', 'Saved to ABHA as MedicationRequest'], window: 'Asked you at 18:20 · you replied at 18:31', proof: ['ABHA txn 7f3c…a91'] } },
    appt: { id: 'a-appt', member: 'maa', icon: 'cal', cat: 'appointment', week: true, tag: 'you', time: 'Mon',
      text: 'Confirmed cardiology appointment with Dr. Mehta, 12 Oct',
      sub: '11:00 · Dr. Mehta Heart Clinic, Hazratganj',
      detail: { trigger: 'Dr. Mehta asked for a follow-up in 4 weeks', did: ['Found 3 open slots by phone (Gnani)', 'You picked Mon 12 Oct, 11:00', 'Clinic confirmed by SMS'], window: 'New appointments always need your OK', proof: ['Clinic ref HC-1012-07'] } },
    reports: { id: 'a-reports', member: 'maa', icon: 'file', cat: 'record', week: true, tag: 'sanjeevani', time: 'Mon',
      text: "4 reports added to Maa's ABHA record",
      sub: 'HbA1c, Lipid profile, CBC, Urine routine · Dr. Lal PathLabs',
      detail: { trigger: 'Lab emailed the reports', did: ['Read 4 PDFs', 'Converted to FHIR DiagnosticReport', 'Pushed to ABHA under consent'], window: 'Consent valid till Mar 2027', proof: ['ABHA txn 91ab…3c0', 'ABHA txn 91ab…3c1'] } },
    papaRxAsk: { id: 'a-papa-rx', member: 'papa', icon: 'escalate', cat: 'record', week: false, tag: 'asked', time: 'Wed 30 Sep',
      text: "Read Dr. Rao's new prescription for Papa — 1 new medicine needs your OK",
      sub: 'Rosuvastatin 10mg · not in his standing refills yet',
      detail: { trigger: 'Photo shared by Papa on WhatsApp', did: ['Read 3 medicines (96% confidence)', 'Two already in refills, one is new', 'New medicines always come to you first'], window: 'Waiting for you · nothing ordered yet', proof: ['Kept locally until Papa\'s ABHA is linked'] } },
    mjCalc: { id: 'a-mj-calc', member: 'mummyji', icon: 'truck', cat: 'medicine', week: false, tag: 'sanjeevani', time: 'Wed 30 Sep',
      text: "Mummy-ji's Calcium + D3 handed to local partner (Kanpur)",
      sub: 'Delivery not confirmed yet · checking with partner',
      detail: { trigger: 'Stock reached 7 days', did: ['Ordered from Kanpur Medicos', 'Handed to local partner 30 Sep', 'No delivery scan for 48h — marked Unconfirmed'], window: 'Within your limits', proof: ['Partner ref KNP-LP-8813'] } },
    mjSync: { id: 'a-mj-sync', member: 'mummyji', icon: 'file', cat: 'record', week: false, tag: 'failed', time: 'Last week',
      text: "Mummy-ji's thyroid report didn't save on the first try",
      sub: 'ABDM gateway timed out · retried once · kept in your Sanjeevani record',
      detail: { trigger: 'Report from Dr. Verma\'s clinic', did: ['First push timed out', 'Retried after 10 minutes', 'Kept locally — her ABHA is not linked yet'], window: 'No action needed', proof: ['Retry log RT-2209'] } },
    // Scenario-only rows
    told: { id: 'a-told', member: 'maa', icon: 'escalate', cat: 'medicine', week: true, tag: 'asked', time: 'Today 9:58am',
      text: "Told you Maa's Amlodipine is down to 3 days",
      sub: 'Reordering at 10:08 unless you reply STOP · sent to you and Rohan',
      detail: { trigger: 'Stock hit 3 days', did: ['WhatsApp to you (away) and Rohan', 'Opened a 10-minute STOP window'], window: 'Told you 09:58 · 10-min STOP window', proof: ['wamid.HBgM…77A'] } },
    sentRohan: { id: 'a-sent-rohan', member: 'papa', icon: 'escalate', cat: 'record', week: true, tag: 'sanjeevani', time: 'Today 2:30pm',
      text: "Sent Papa's new prescription to Rohan to decide",
      sub: "You're away · Rosuvastatin 10mg is new for Papa",
      detail: { trigger: 'New prescription from Dr. Rao (photo, 96% confidence)', did: ['Read 3 medicines', 'One is new — new medicines always need a person', 'Routed to Rohan because you are away'], window: 'Nothing ordered until Rohan replies', proof: ['wamid.HBgM…9C1'] } },
    rohanOk: { id: 'a-rohan-ok', member: 'papa', icon: 'pill', cat: 'medicine', week: true, tag: 'rohan', time: 'Today 3:05pm',
      text: "Added Rosuvastatin 10mg to Papa's refills",
      sub: 'Rohan approved on WhatsApp · first strip ordered',
      detail: { trigger: 'Rohan replied "yes, add it"', did: ['Added to standing refills', 'First strip ordered from Apollo Pharmacy'], window: 'Decided by Rohan (backup) while you were away', proof: ['Order APL-LKO-55890'], undo: 'Remove from refills' } },
    delivered: { id: 'a-delivered', member: 'maa', icon: 'truck', cat: 'medicine', week: true, tag: 'sanjeevani', time: 'Thu 11:20am',
      text: 'Amlodipine delivered to Maa',
      sub: 'Local partner · photo proof at the door · stock reset to 30 days',
      detail: { trigger: 'Delivery scan from local partner', did: ['Delivery confirmed with photo', 'Stock reset only after confirmation'], window: 'No action needed', proof: ['Waybill LKO-LP-20931 · POD photo'] } },
    voiceArrived: { id: 'a-voice-arrived', member: 'maa', icon: 'voice', cat: 'medicine', week: true, tag: 'sanjeevani', time: 'Thu 11:24am',
      text: 'Maa was told her medicine has arrived',
      sub: "Voice note, Hindi · ● Acknowledged: 'haan, mil gayi'",
      detail: { trigger: 'Delivery confirmed', did: ['Gnani voice note in Hindi (12s)', "Maa replied 'haan, mil gayi'"], window: 'Outcome only', proof: ['wamid.HBgM…B12'] } }
  };

  /* ---------------- Records (Maa's ABHA) ---------------- */
  function records() {
    const R = (id, date, ts, type, title, from, source, extraction, abha, extra) => Object.assign({ id, member: 'maa', date, ts, type, title, from, source, extraction, abha }, extra || {});
    return [
      R('r1', '2 Oct 2026', 20261002, 'rx', 'Prescription', 'Dr. Mehta · Cardiology', 'WhatsApp', { kind: 'confirmed' }, 'synced', { meds: ['Telmisartan 40mg · OD', 'Metformin 1000mg · BD · 30 days', 'Amlodipine 5mg · OD'] }),
      R('r2', '28 Sep 2026', 20260928, 'lab', 'ECG', 'Sahara Hospital', 'WhatsApp', { kind: 'confirm-needed' }, 'retrying', { result: 'Sinus rhythm · rate 78 bpm' }),
      R('r3', '28 Sep 2026', 20260928, 'lab', 'HbA1c', 'Dr. Lal PathLabs', 'Email', { kind: 'good', pct: 99 }, 'synced', { result: '7.4 %' }),
      R('r4', '28 Sep 2026', 20260928, 'lab', 'Lipid profile', 'Dr. Lal PathLabs', 'Email', { kind: 'good', pct: 98 }, 'synced', { result: 'LDL 118 · HDL 46 · TG 162 mg/dL' }),
      R('r5', '28 Sep 2026', 20260928, 'lab', 'CBC', 'Dr. Lal PathLabs', 'Email', { kind: 'good', pct: 98 }, 'synced', { result: 'Hb 12.1 g/dL · WBC 7.2k' }),
      R('r6', '28 Sep 2026', 20260928, 'lab', 'Urine routine', 'Dr. Lal PathLabs', 'Email', { kind: 'good', pct: 97 }, 'synced', { result: 'No abnormality detected' }),
      R('r7', '12 Sep 2026', 20260912, 'rx', 'Prescription', 'Dr. Mehta · Cardiology', 'WhatsApp', { kind: 'good', pct: 97 }, 'synced', { meds: ['Telmisartan 40mg · OD', 'Amlodipine 5mg · OD'] }),
      R('r8', '28 Aug 2026', 20260828, 'rx', 'Prescription', 'Dr. Rao · General Medicine', 'Doctor input', { kind: 'good', pct: 99 }, 'synced', { meds: ['Metformin 1000mg · BD · 30 days'] }),
      R('r9', '12 Aug 2026', 20260812, 'lab', 'Kidney function', 'Dr. Lal PathLabs', 'Email', { kind: 'good', pct: 98 }, 'synced', { result: 'Creatinine 0.9 mg/dL' }),
      R('r10', '30 Jul 2026', 20260730, 'lab', 'HbA1c', 'Dr. Lal PathLabs', 'Email', { kind: 'good', pct: 99 }, 'synced', { result: '7.2 %' }),
      R('r11', '30 Jul 2026', 20260730, 'rx', 'Prescription', 'Dr. Rao · General Medicine', 'WhatsApp', { kind: 'good', pct: 94 }, 'synced', { meds: ['Metformin 500mg · BD'] }),
      R('r12', '4 Jun 2026', 20260604, 'discharge', 'Discharge summary', 'Sahara Hospital', 'Email', { kind: 'confirmed' }, 'synced', { result: '2-day observation · chest discomfort · ECG and echo normal' }),
      R('r13', '3 Jun 2026', 20260603, 'scan', 'Echocardiogram', 'Sahara Hospital', 'Email', { kind: 'good', pct: 97 }, 'synced', { result: 'EF 60% · no regional wall motion abnormality' }),
      R('r14', '28 May 2026', 20260528, 'lab', 'HbA1c', 'Pathkind Labs', 'WhatsApp', { kind: 'good', pct: 95 }, 'synced', { result: '7.1 %' }),
      R('r15', '15 May 2026', 20260515, 'lab', 'Kidney function', 'Pathkind Labs', 'WhatsApp', { kind: 'good', pct: 96 }, 'synced', { result: 'Creatinine 0.9 mg/dL' }),
      R('r16', '15 May 2026', 20260515, 'lab', 'Thyroid profile', 'Pathkind Labs', 'WhatsApp', { kind: 'good', pct: 96 }, 'synced', { result: 'TSH 2.4 mIU/L' }),
      R('r17', '15 May 2026', 20260515, 'rx', 'Prescription', 'Sharma Clinic, Aliganj', 'WhatsApp', { kind: 'good', pct: 92 }, 'local', { meds: ['Pantoprazole 40mg · OD · 14 days'], note: 'Clinic not on ABDM' }),
      R('r18', '20 Mar 2026', 20260320, 'lab', 'HbA1c', 'City Diagnostics, Lucknow', 'WhatsApp', { kind: 'good', pct: 93 }, 'local', { result: '6.9 %', note: 'Lab not on ABDM' }),
      R('r19', '10 Feb 2026', 20260210, 'scan', 'Chest X-ray', 'Medanta Lucknow', 'Email', { kind: 'good', pct: 96 }, 'synced', { result: 'Clear lung fields' }),
      R('r20', '10 Feb 2026', 20260210, 'scan', 'Ultrasound abdomen', 'Medanta Lucknow', 'WhatsApp', { kind: 'good', pct: 95 }, 'synced', { result: 'Mild fatty liver' }),
      R('r21', '10 Feb 2026', 20260210, 'rx', 'Prescription', 'Medanta Lucknow', 'Email', { kind: 'good', pct: 98 }, 'synced', { meds: ['Telmisartan 40mg · OD'] }),
      R('r22', '12 Jan 2026', 20260112, 'lab', 'HbA1c', 'City Diagnostics, Lucknow', 'WhatsApp', { kind: 'good', pct: 91 }, 'local', { result: '6.8 %', note: 'Lab not on ABDM' })
    ];
  }

  const DELIVERY_STEPS = [
    { label: 'Reorder triggered', time: 'Today 09:58' },
    { label: 'You were told (no STOP)', time: '10:08' },
    { label: 'Apollo confirmed stock', time: '10:11' },
    { label: 'Paid ₹184 · Pine Labs', time: '10:13' },
    { label: 'Shipped · Local partner', time: '13:40', chip: true },
    { label: 'Delivered', time: 'Expected Thu', doneTime: 'Thu 11:20' },
    { label: 'Maa told by voice note', time: 'after delivery', doneTime: 'Thu 11:24' }
  ];

  const DECISIONS = {
    rosu: { id: 'rosu', member: 'papa', kind: 'approve', title: "New prescription from Dr. Rao — add Rosuvastatin 10mg to Papa's refills?", context: 'Read from photo, 30 Sep · 96% confidence', primary: 'Add to refills', secondary: 'Review' },
    amloName: { id: 'amlo-name', member: 'mummyji', kind: 'choice', title: "Couldn't read one medicine name clearly", context: "Dr. Verma's prescription for Mummy-ji, 1 Oct", options: ['Amlodipine', 'Amlokind'] }
  };

  /* ---------------- Snapshot (step 0) ---------------- */
  function snapshot() {
    return {
      rev: 'snapshot',
      step: 0,
      today: '2026-10-03',
      updated: '2 min ago',
      caregiver: { name: 'Pursharth', family: 'Sharma family', initials: 'PS', phone: '+91 98••• ••210', away: false, away_until: 'Mon, 12 Oct' },
      backup: { name: 'Rohan', relation: 'brother', reachable: true },
      members: members(),
      decisions: [clone(DECISIONS.rosu), clone(DECISIONS.amloName)],
      delivery: { item: 'Amlodipine 5mg', member: 'maa', city: 'Lucknow', route: 'local', done: 5, steps: clone(DELIVERY_STEPS) },
      activity: [A.voiceEta, A.shipped, A.paid, A.reorder, A.readRx, A.appt, A.reports, A.papaRxAsk, A.mjCalc, A.mjSync].map(clone),
      upcoming: [
        { day: 'Wed 7', text: 'Metformin auto-reorder', member: 'maa', icon: 'pill' },
        { day: 'Thu 8', text: 'Amlodipine arrives', member: 'maa', icon: 'truck', id: 'arrive' },
        { day: 'Mon 12', text: 'Dr. Mehta · Cardiology · 11:00', member: 'maa', icon: 'cal', status: ['good', 'Confirmed'] },
        { day: 'Thu 15', text: 'Creatinine test due', member: 'maa', icon: 'tube', status: ['warn', 'Not booked'] },
        { day: 'Fri 16', text: 'Dr. Rao · General Medicine · 10:30', member: 'papa', icon: 'cal', status: ['neutral', 'Waiting'] },
        { day: 'Sat 17', text: 'Typhoid booster due', member: 'anya', icon: 'tube', status: ['warn', 'Not booked'] }
      ],
      records: records(),
      abha: { last_sync: '09:40' },
      mandate: { provider: 'Pine Labs', cap: 3000, used: 1184, status: 'active', lastDebit: '₹184 · Apollo · today' },
      kpis: { missed: 0, days: 21, nextReorder: 'Metformin (Maa), Wed' },
      toast: null
    };
  }

  /* ---------------- Story steps 1–8 ---------------- */
  function scenario(step) {
    step = Math.max(0, Math.min(8, step | 0));
    if (step === 0) return snapshot();
    const s = snapshot();
    const maa = s.members.find((m) => m.id === 'maa');
    const amlo = maa.medicines.find((m) => m.id === 'amlo');
    const add = (row) => s.activity.unshift(clone(row));

    // 1. Normal day
    s.rev = 'step-1'; s.step = 1; s.updated = '2 min ago';
    s.decisions = [];
    s.delivery = null;
    amlo.days = 4; amlo.next = { kind: 'auto', text: 'Reorders automatically tomorrow' };
    s.activity = [A.readRx, A.appt, A.reports, A.mjCalc, A.mjSync].map(clone);
    s.upcoming = s.upcoming.filter((u) => u.id !== 'arrive');
    s.upcoming.unshift({ day: 'Sun 4', text: 'Amlodipine auto-reorder', member: 'maa', icon: 'pill' });
    s.mandate.used = 1000; s.mandate.lastDebit = '₹412 · Apollo · 22 Sep';
    if (step === 1) return s;

    // 2. Boards a flight
    s.rev = 'step-2'; s.step = 2; s.updated = 'just now';
    s.caregiver.away = true;
    if (step === 2) return s;

    // 3. Stock hits 3 days
    s.rev = 'step-3'; s.step = 3;
    amlo.days = 3; amlo.next = { kind: 'told', text: 'Reorders automatically at 10:08 · reply STOP to cancel' };
    s.upcoming.shift();
    add(A.told);
    s.delivery = { item: 'Amlodipine 5mg', member: 'maa', city: 'Lucknow', route: 'local', done: 1, steps: clone(DELIVERY_STEPS) };
    if (step === 3) return s;

    // 4. No STOP, reorder placed
    s.rev = 'step-4'; s.step = 4;
    amlo.next = { kind: 'placed', text: 'Reorder placed today · arriving Thu' };
    s.delivery.done = 4;
    add(A.reorder); add(A.paid);
    s.mandate.used = 1184; s.mandate.lastDebit = '₹184 · Apollo · today';
    s.upcoming.splice(1, 0, { day: 'Thu 8', text: 'Amlodipine arrives', member: 'maa', icon: 'truck', id: 'arrive' });
    if (step === 4) return s;

    // 5. New prescription arrives (routed to Rohan because she's away)
    s.rev = 'step-5'; s.step = 5;
    s.delivery.done = 5;
    add(A.shipped);
    s.decisions = [clone(DECISIONS.rosu)];
    s.decisions[0].context = 'Read from photo, today · 96% confidence';
    add(A.sentRohan);
    if (step === 5) return s;

    // 6. Rohan approves
    s.rev = 'step-6'; s.step = 6;
    s.decisions = [];
    add(A.rohanOk);
    s.members.find((m) => m.id === 'papa').medicines.push({ id: 'rosu', name: 'Rosuvastatin 10mg', freq: 'once daily', days: 30, pharmacy: 'Apollo Pharmacy', next: { kind: 'placed', text: 'Reorder placed today · arriving Tue' }, confirmed: 'new — first strip' });
    if (step === 6) return s;

    // 7. Delivered
    s.rev = 'step-7'; s.step = 7;
    s.delivery.done = 7;
    amlo.days = 33; amlo.next = { kind: 'auto', text: 'Reorders automatically in 26 days' }; amlo.confirmed = 'delivery, Thu 8 Oct';
    maa.lastRefill = { where: 'Apollo Pharmacy', when: 'Thu 8 Oct' };
    add(A.delivered); add(A.voiceArrived);
    s.upcoming = s.upcoming.filter((u) => u.id !== 'arrive');
    if (step === 7) return s;

    // 8. She lands
    s.rev = 'step-8'; s.step = 8;
    s.caregiver.away = false;
    s.toast = 'While you were away: 4 actions, 0 missed.';
    return s;
  }

  const api = { scenario, STEPS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    if (require.main === module) process.stdout.write(JSON.stringify(scenario(+(process.argv[2] || 0)), null, 2) + '\n');
  } else {
    root.SanjeevaniDemo = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
