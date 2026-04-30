import { Fragment, type ChangeEvent, useMemo, useRef, useState } from 'react';
import { formatCurrency } from '../engine/projection';
import { parseExpenseImportFiles } from '../importers/expenseImport';
import type {
  BankAccountDefinition,
  ExpensesConfig,
  ExpenseEntry,
  NetWorthHistoryEntry,
  PoolDefinition,
  ProjectionYear,
  RecurringEventCadence,
  RecurringEventRule,
  RecurringExpenseEvent
} from '../types';

const DEFAULT_CATEGORY_LABELS = ['Subscription', 'Gas', 'Purchases', 'Fun'];
const RAINBOW_COLOR_PRESETS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#6366f1', '#a855f7'];
const BOX_HEIGHT = 26;
const BOX_GAP = 4;
const WEEK_WIDTH = 130;
const VISIBLE_BOX_COUNT = 1;
const HEADER_ROW_HEIGHT = 34;
const LEFT_COLUMN_WIDTH = 180;
const RIGHT_AXIS_GUTTER = 80;

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const parseIsoDate = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const clampIsoDate = (value: string, minDate: string, maxDate: string) => {
  const parsed = parseIsoDate(value);
  const minParsed = parseIsoDate(minDate);
  const maxParsed = parseIsoDate(maxDate);
  if (!parsed || !minParsed || !maxParsed) {
    return minDate;
  }
  if (parsed < minParsed) {
    return minDate;
  }
  if (parsed > maxParsed) {
    return maxDate;
  }
  return value;
};
const getTimelineBounds = () => {
  const now = new Date();
  return {
    minDate: toIsoDate(now),
    maxDate: toIsoDate(addDays(now, 365))
  };
};
const makeExpenseId = () => `expense-entry-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeCategoryId = () => `expense-category-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeRecurringId = () => `recurring-expense-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const todayIsoDate = () => toIsoDate(new Date());

const startOfWeek = (value: string, weekStartDay: number) => {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    return value;
  }
  const copy = new Date(parsed);
  const day = copy.getDay();
  const normalizedStart = Math.min(6, Math.max(0, weekStartDay));
  const offset = (day - normalizedStart + 7) % 7;
  copy.setDate(copy.getDate() - offset);
  return toIsoDate(copy);
};

const nextWeekStartFrom = (value: Date, weekStartDay: number) => {
  const copy = new Date(value);
  const normalizedStart = Math.min(6, Math.max(0, weekStartDay));
  const delta = (normalizedStart - copy.getDay() + 7) % 7;
  copy.setDate(copy.getDate() + delta);
  return toIsoDate(copy);
};

const getWeekKeys = (startDate: string, endDate: string, weekStartDay: number) => {
  const start = parseIsoDate(startOfWeek(startDate, weekStartDay));
  const end = parseIsoDate(endDate);
  if (!start || !end) {
    return [] as string[];
  }

  const weeks: string[] = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    weeks.push(toIsoDate(cursor));
    cursor = addDays(cursor, 7);
  }
  return weeks;
};

const resolveRecurringDates = (event: RecurringExpenseEvent, weekStart: string) => {
  const weekStartDate = parseIsoDate(weekStart);
  if (!weekStartDate) {
    return [] as string[];
  }

  const dates: string[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(weekStartDate, offset);
    const iso = toIsoDate(date);
    if (iso < event.startDate || iso > event.endDate) {
      continue;
    }

    if (event.rule === 'every_friday' && date.getDay() === 5) {
      dates.push(iso);
      continue;
    }

    if (event.rule === 'on_date') {
      if (event.cadence === 'weekly' && date.getDay() === parseIsoDate(event.startDate)?.getDay()) {
        dates.push(iso);
      } else if (event.cadence === 'monthly' && date.getDate() === (event.dayOfMonth ?? parseIsoDate(event.startDate)?.getDate() ?? 1)) {
        dates.push(iso);
      }
      continue;
    }

    if (event.rule === 'first_monday_after') {
      const anchor = parseIsoDate(event.anchorDate || event.startDate);
      if (!anchor) {
        continue;
      }
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      let cursor = new Date(Math.max(monthStart.getTime(), anchor.getTime()));
      while (cursor.getDay() !== 1) {
        cursor = addDays(cursor, 1);
      }
      if (toIsoDate(cursor) === iso) {
        dates.push(iso);
      }
    }
  }

  return dates;
};

const parseCsvPreview = (text: string) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return [] as string[][];
  }

  const parseLine = (line: string) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (inQuotes && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (char === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    cells.push(current.trim());
    return cells;
  };

  return lines.map(parseLine);
};

interface ExpensesPlannerProps {
  expenses: ExpensesConfig;
  bankAccounts: BankAccountDefinition[];
  pools: PoolDefinition[];
  netWorthHistory: NetWorthHistoryEntry[];
  projectionYears: ProjectionYear[];
  onChange: (next: ExpensesConfig) => void;
}

interface RecurringDraftState {
  label: string;
  amount: number;
  paymentAccountId: string;
  color: string;
  cadence: RecurringEventCadence;
  rule: RecurringEventRule;
  startDate: string;
  endDate: string;
  dayOfMonth: number;
  anchorDate: string;
}

interface CellContextMenuState {
  x: number;
  y: number;
  weekStartDate: string;
  categoryId: string | null;
  entryId?: string;
  recurringEventId?: string;
}

interface OneTimeDraftState {
  label: string;
  amount: number;
  date: string;
  accountId: string;
  categoryId: string | null;
  color: string;
}

type CopiedEventPayload =
  | {
      kind: 'one_time';
      label: string;
      amount: number;
      accountId: string;
      categoryId: string | null;
      color: string;
    }
  | {
      kind: 'recurring';
      label: string;
      amount: number;
      accountId: string;
      paymentAccountId: string | null;
      categoryId: string | null;
      color: string;
      cadence: RecurringEventCadence;
      rule: RecurringEventRule;
      dayOfMonth: number;
      anchorDate: string;
    };

export const ExpensesPlanner = ({
  expenses,
  bankAccounts,
  pools,
  netWorthHistory,
  projectionYears,
  onChange
}: ExpensesPlannerProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [cellContextMenu, setCellContextMenu] = useState<CellContextMenuState | null>(null);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [editingRecurringEventId, setEditingRecurringEventId] = useState<string | null>(null);
  const [showOneTimeModal, setShowOneTimeModal] = useState(false);
  const [editingOneTimeEventId, setEditingOneTimeEventId] = useState<string | null>(null);
  const [copiedEvent, setCopiedEvent] = useState<CopiedEventPayload | null>(null);
  const [showImportsModal, setShowImportsModal] = useState(false);
  const [expandedImportIds, setExpandedImportIds] = useState<string[]>([]);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [recurringDraft, setRecurringDraft] = useState<RecurringDraftState>({
    label: 'Recurring Event',
    amount: 50,
    paymentAccountId: bankAccounts[0]?.id ?? '',
    color: '#3b82f6',
    cadence: 'weekly' as const,
    rule: 'every_friday' as const,
    startDate: expenses.ui.windowStartDate,
    endDate: expenses.ui.windowEndDate,
    dayOfMonth: 1,
    anchorDate: expenses.ui.windowStartDate
  });
  const [oneTimeDraft, setOneTimeDraft] = useState<OneTimeDraftState>({
    label: 'Event',
    amount: 50,
    date: expenses.ui.windowStartDate,
    accountId: bankAccounts[0]?.id ?? '',
    categoryId: null,
    color: '#3b82f6'
  });
  const { minDate, maxDate } = getTimelineBounds();

  const accountById = useMemo(() => new Map(bankAccounts.map((account) => [account.id, account])), [bankAccounts]);
  const poolById = useMemo(() => new Map(pools.map((pool) => [pool.id, pool])), [pools]);

  const activeAccountId =
    expenses.activePlanningAccountId && accountById.has(expenses.activePlanningAccountId)
      ? expenses.activePlanningAccountId
      : bankAccounts[0]?.id ?? null;
  const planningWeekStartDay = Math.min(6, Math.max(0, expenses.ui.planningWeekStartDay ?? 5));

  const updateExpenses = (next: Partial<ExpensesConfig>) => {
    onChange({
      ...expenses,
      ...next
    });
  };

  const updateUi = (next: Partial<ExpensesConfig['ui']>) => {
    updateExpenses({
      ui: {
        ...expenses.ui,
        ...next
      }
    });
  };

  const seededCategoriesByAccountId = useMemo(() => {
    const next = { ...expenses.categoriesByAccountId };
    bankAccounts.forEach((account) => {
      if (!next[account.id] || next[account.id].length === 0) {
        next[account.id] = DEFAULT_CATEGORY_LABELS.map((label, index) => ({
          id: `${account.id}-category-${index + 1}`,
          label
        }));
      }
    });
    return next;
  }, [bankAccounts, expenses.categoriesByAccountId]);

  const categories = activeAccountId ? seededCategoriesByAccountId[activeAccountId] ?? [] : [];
  const weekKeys = getWeekKeys(expenses.ui.windowStartDate, expenses.ui.windowEndDate, planningWeekStartDay);

  const updateEntry = (entryId: string, changes: Partial<ExpenseEntry>) => {
    updateExpenses({
      entries: expenses.entries.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              ...changes,
              updatedAt: todayIsoDate()
            }
          : entry
      )
    });
  };

  const setActiveAccount = (accountId: string) => {
    updateExpenses({
      activePlanningAccountId: accountId,
      categoriesByAccountId: seededCategoriesByAccountId
    });
  };

  const openCreateOneTimeModal = (weekStartDate?: string, categoryId?: string | null) => {
    const accountId = activeAccountId ?? bankAccounts[0]?.id ?? '';
    const defaultCategoryId =
      categoryId === undefined ? (seededCategoriesByAccountId[accountId] ?? [])[0]?.id ?? null : categoryId;
    setOneTimeDraft({
      label: 'Event',
      amount: 50,
      date: clampIsoDate(weekStartDate ?? expenses.ui.windowStartDate, minDate, maxDate),
      accountId,
      categoryId: defaultCategoryId,
      color: '#3b82f6'
    });
    setEditingOneTimeEventId(null);
    setShowOneTimeModal(true);
  };

  const addManualExpense = () => {
    openCreateOneTimeModal(expenses.ui.scrubberDate || minDate);
  };

  const addManualExpenseAtCell = (weekStartDate: string, categoryId: string | null) => {
    openCreateOneTimeModal(weekStartDate, categoryId);
  };

  const skipToToday = () => {
    const nextStart = nextWeekStartFrom(new Date(), planningWeekStartDay);
    const currentStart = parseIsoDate(expenses.ui.windowStartDate);
    const currentEnd = parseIsoDate(expenses.ui.windowEndDate);
    const spanDays = currentStart && currentEnd ? Math.max(0, Math.round((currentEnd.getTime() - currentStart.getTime()) / (1000 * 60 * 60 * 24))) : 84;
    const clampedStart = clampIsoDate(nextStart, minDate, maxDate);
    const candidateEnd = toIsoDate(addDays(parseIsoDate(clampedStart) ?? new Date(), spanDays));
    const clampedEnd = clampIsoDate(candidateEnd, clampedStart, maxDate);
    updateUi({
      windowStartDate: clampedStart,
      windowEndDate: clampedEnd,
      scrubberDate: clampedStart
    });
  };

  const saveOneTimeEvent = () => {
    const account = oneTimeDraft.accountId ? accountById.get(oneTimeDraft.accountId) : null;
    const clampedDate = clampIsoDate(oneTimeDraft.date, minDate, maxDate);

    if (editingOneTimeEventId) {
      updateExpenses({
        entries: expenses.entries.map((entry) =>
          entry.id === editingOneTimeEventId
            ? {
                ...entry,
                label: oneTimeDraft.label || entry.label,
                amount: Math.max(0, oneTimeDraft.amount),
                startDate: clampedDate,
                endDate: clampedDate,
                accountId: oneTimeDraft.accountId || null,
                poolId: account?.poolId ?? null,
                categoryId: oneTimeDraft.categoryId ?? null,
                color: oneTimeDraft.color,
                updatedAt: todayIsoDate()
              }
            : entry
        )
      });
    } else {
      updateExpenses({
        categoriesByAccountId: seededCategoriesByAccountId,
        entries: [
          ...expenses.entries,
          {
            id: makeExpenseId(),
            label: oneTimeDraft.label || 'Event',
            amount: Math.max(0, oneTimeDraft.amount),
            startDate: clampedDate,
            endDate: clampedDate,
            accountId: oneTimeDraft.accountId || null,
            poolId: account?.poolId ?? null,
            notes: '',
            originType: 'manual',
            importSourceId: null,
            importBatchId: null,
            createdAt: todayIsoDate(),
            updatedAt: todayIsoDate(),
            categoryId: oneTimeDraft.categoryId ?? null,
            color: oneTimeDraft.color
          }
        ]
      });
    }

    setShowOneTimeModal(false);
    setEditingOneTimeEventId(null);
  };

  const pasteEventAtCell = (weekStartDate: string, categoryId: string | null) => {
    if (!copiedEvent) {
      return;
    }

    const targetDate = clampIsoDate(weekStartDate, minDate, maxDate);

    if (copiedEvent.kind === 'one_time') {
      const account = accountById.get(copiedEvent.accountId) ?? accountById.get(activeAccountId ?? '');
      updateExpenses({
        entries: [
          ...expenses.entries,
          {
            id: makeExpenseId(),
            label: copiedEvent.label,
            amount: copiedEvent.amount,
            startDate: targetDate,
            endDate: targetDate,
            accountId: account?.id ?? activeAccountId ?? null,
            poolId: account?.poolId ?? null,
            notes: '',
            originType: 'manual',
            importSourceId: null,
            importBatchId: null,
            createdAt: todayIsoDate(),
            updatedAt: todayIsoDate(),
            categoryId,
            color: copiedEvent.color
          }
        ]
      });
      return;
    }

    updateExpenses({
      recurringEvents: [
        ...(expenses.recurringEvents ?? []),
        {
          id: makeRecurringId(),
          label: copiedEvent.label,
          amount: copiedEvent.amount,
          accountId: copiedEvent.accountId || activeAccountId || '',
          paymentAccountId: copiedEvent.paymentAccountId ?? copiedEvent.accountId ?? activeAccountId ?? null,
          categoryId,
          color: copiedEvent.color,
          cadence: copiedEvent.cadence,
          rule: copiedEvent.rule,
          startDate: targetDate,
          endDate: expenses.ui.windowEndDate,
          dayOfMonth: copiedEvent.dayOfMonth,
          anchorDate: copiedEvent.anchorDate || targetDate,
          enabled: true
        }
      ]
    });
  };

  const addRecurringEvent = () => {
    if (!activeAccountId) {
      return;
    }
    updateExpenses({
      recurringEvents: [
        ...(expenses.recurringEvents ?? []),
        {
          id: makeRecurringId(),
          label: recurringDraft.label || 'Recurring Event',
          amount: Math.max(0, recurringDraft.amount),
          accountId: activeAccountId,
          paymentAccountId: recurringDraft.paymentAccountId || activeAccountId,
          categoryId: (categories[0]?.id ?? null),
          color: recurringDraft.color,
          cadence: recurringDraft.cadence,
          rule: recurringDraft.rule,
          startDate: clampIsoDate(recurringDraft.startDate, minDate, maxDate),
          endDate: clampIsoDate(recurringDraft.endDate, minDate, maxDate),
          dayOfMonth: recurringDraft.dayOfMonth,
          anchorDate: recurringDraft.anchorDate,
          enabled: true
        }
      ]
    });
    setShowRecurringModal(false);
    setEditingRecurringEventId(null);
  };

  const saveRecurringEventEdit = () => {
    if (!editingRecurringEventId) {
      return;
    }
    updateExpenses({
      recurringEvents: (expenses.recurringEvents ?? []).map((event) =>
        event.id === editingRecurringEventId
          ? {
              ...event,
              label: recurringDraft.label || event.label,
              amount: Math.max(0, recurringDraft.amount),
              paymentAccountId: recurringDraft.paymentAccountId || event.paymentAccountId || event.accountId,
              cadence: recurringDraft.cadence,
              rule: recurringDraft.rule,
              startDate: clampIsoDate(recurringDraft.startDate, minDate, maxDate),
              endDate: clampIsoDate(recurringDraft.endDate, minDate, maxDate),
              dayOfMonth: recurringDraft.dayOfMonth,
              anchorDate: recurringDraft.anchorDate,
              color: recurringDraft.color
            }
          : event
      )
    });
    setShowRecurringModal(false);
    setEditingRecurringEventId(null);
  };

  const addRecurringEventAtCell = (weekStartDate: string, categoryId: string | null) => {
    if (!activeAccountId) {
      return;
    }
    updateExpenses({
      recurringEvents: [
        ...(expenses.recurringEvents ?? []),
        {
          id: makeRecurringId(),
          label: 'Recurring Event',
          amount: 50,
          accountId: activeAccountId,
          paymentAccountId: activeAccountId,
          categoryId,
          color: '#3b82f6',
          cadence: 'weekly',
          rule: 'every_friday',
          startDate: clampIsoDate(weekStartDate, minDate, maxDate),
          endDate: expenses.ui.windowEndDate,
          dayOfMonth: 1,
          anchorDate: clampIsoDate(weekStartDate, minDate, maxDate),
          enabled: true
        }
      ]
    });
  };

  const removeEntry = (entryId: string) => {
    updateExpenses({ entries: expenses.entries.filter((entry) => entry.id !== entryId) });
  };

  const deleteContextMenuEvent = (entryId?: string, recurringEventId?: string) => {
    if (entryId) {
      const source = expenses.entries.find((entry) => entry.id === entryId);
      if (!source) {
        return;
      }
      const shouldDelete = window.confirm(`Delete event "${source.label}"?`);
      if (!shouldDelete) {
        return;
      }
      removeEntry(entryId);
      return;
    }

    if (recurringEventId) {
      const source = (expenses.recurringEvents ?? []).find((event) => event.id === recurringEventId);
      if (!source) {
        return;
      }
      const shouldDelete = window.confirm(`Delete recurring event "${source.label}" and all of its occurrences?`);
      if (!shouldDelete) {
        return;
      }
      updateExpenses({
        recurringEvents: (expenses.recurringEvents ?? []).filter((event) => event.id !== recurringEventId)
      });
    }
  };

  const applyImportSource = (sourceId: string) => {
    updateExpenses({
      imports: expenses.imports.map((source) =>
        source.id === sourceId
          ? {
              ...source,
              status: source.entryIds.length > 0 ? 'applied' : source.status,
              appliedAt: todayIsoDate()
            }
          : source
      )
    });
  };

  const updateImportSource = (sourceId: string, changes: Partial<ExpensesConfig['imports'][number]>) => {
    updateExpenses({
      imports: expenses.imports.map((source) => (source.id === sourceId ? { ...source, ...changes } : source))
    });
  };

  const removeImportSource = (sourceId: string) => {
    updateExpenses({
      imports: expenses.imports.filter((source) => source.id !== sourceId),
      entries: expenses.entries.filter((entry) => entry.importSourceId !== sourceId)
    });
  };

  const toggleExpandedImport = (sourceId: string) => {
    setExpandedImportIds((current) => (current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]));
    setSelectedImportId(sourceId);
  };

  const onImportFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length === 0) {
      return;
    }

    setIsImporting(true);
    try {
      const parsed = await parseExpenseImportFiles(selected, bankAccounts, pools);
      const nextImports = parsed.map((item) => item.source);
      const nextEntries = parsed.flatMap((item) => item.entries);
      updateExpenses({
        imports: [...expenses.imports, ...nextImports],
        entries: [...expenses.entries, ...nextEntries],
        categoriesByAccountId: seededCategoriesByAccountId
      });
      if (nextImports.length > 0) {
        setSelectedImportId(nextImports[0].id);
        setExpandedImportIds((current) => [...new Set([...current, ...nextImports.map((item) => item.id)])]);
      }
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const addCategory = () => {
    if (!activeAccountId) {
      return;
    }
    const label = newCategoryLabel.trim();
    if (label.length === 0) {
      return;
    }
    const next = {
      ...seededCategoriesByAccountId,
      [activeAccountId]: [...(seededCategoriesByAccountId[activeAccountId] ?? []), { id: makeCategoryId(), label }]
    };
    updateExpenses({ categoriesByAccountId: next });
    setNewCategoryLabel('');
  };

  const renameCategory = (categoryId: string, label: string) => {
    if (!activeAccountId) {
      return;
    }
    updateExpenses({
      categoriesByAccountId: {
        ...seededCategoriesByAccountId,
        [activeAccountId]: (seededCategoriesByAccountId[activeAccountId] ?? []).map((category) =>
          category.id === categoryId ? { ...category, label } : category
        )
      }
    });
  };

  const removeCategory = (categoryId: string) => {
    if (!activeAccountId) {
      return;
    }
    updateExpenses({
      categoriesByAccountId: {
        ...seededCategoriesByAccountId,
        [activeAccountId]: (seededCategoriesByAccountId[activeAccountId] ?? []).filter((category) => category.id !== categoryId)
      },
      entries: expenses.entries.map((entry) => (entry.categoryId === categoryId ? { ...entry, categoryId: null } : entry))
    });
  };

  const onDropEntry = (categoryId: string | null, weekStartDate: string, entryId: string) => {
    const clampedWeek = clampIsoDate(weekStartDate, minDate, maxDate);
    updateEntry(entryId, {
      categoryId,
      startDate: clampedWeek,
      endDate: clampedWeek
    });
  };

  const recurringOccurrences = (expenses.recurringEvents ?? [])
    .filter((event) => event.enabled && event.accountId === activeAccountId)
    .flatMap((event) =>
      weekKeys.flatMap((week) =>
        resolveRecurringDates(event, week).map((date) => ({
          id: `${event.id}-${date}`,
          label: event.label,
          amount: event.amount,
          startDate: date,
          categoryId: event.categoryId,
          color: event.color,
          recurringEventId: event.id,
          paymentAccountId: event.paymentAccountId ?? event.accountId
        }))
      )
    );

  const activeAccountEntries = expenses.entries.filter((entry) => entry.accountId === activeAccountId);
  const getEntryCardStyle = (color?: string) => {
    if (!color) {
      return undefined;
    }
    return {
      backgroundColor: `${color}22`,
      borderColor: color
    };
  };

  const getEntriesForCell = (categoryId: string | null, weekStartDate: string) => {
    const staticEntries = activeAccountEntries.filter(
      (entry) => entry.categoryId === categoryId && startOfWeek(entry.startDate, planningWeekStartDay) === weekStartDate
    );
    const recurringEntries = recurringOccurrences.filter(
      (entry) => entry.categoryId === categoryId && startOfWeek(entry.startDate, planningWeekStartDay) === weekStartDate
    );
    return [...staticEntries, ...recurringEntries];
  };

  const rowDisplayHeight = (categoryId: string | null) => {
    const maxCount = Math.max(0, ...weekKeys.map((week) => getEntriesForCell(categoryId, week).length));
    const visibleCount = Math.max(VISIBLE_BOX_COUNT, maxCount);
    return visibleCount * BOX_HEIGHT + (visibleCount - 1) * BOX_GAP + 10;
  };

  const categoryRows = [...categories, { id: '__uncategorized__', label: 'Uncategorized' }].map((category) => {
    const categoryId = category.id === '__uncategorized__' ? null : category.id;
    return {
      ...category,
      categoryId,
      rowHeight: rowDisplayHeight(categoryId)
    };
  });
  const categoryOffsets = categoryRows.map((_, rowIndex) =>
    categoryRows.slice(0, rowIndex).reduce((sum, row) => sum + row.rowHeight, 0)
  );
  const gridBodyHeight = categoryRows.reduce((sum, row) => sum + row.rowHeight, 0);
  const gridWidth = LEFT_COLUMN_WIDTH + weekKeys.length * WEEK_WIDTH;
  const shellWidth = gridWidth + RIGHT_AXIS_GUTTER;
  const gridTemplateColumns = `${LEFT_COLUMN_WIDTH}px repeat(${Math.max(1, weekKeys.length)}, ${WEEK_WIDTH}px)`;

  const weeklySpend = weekKeys.map((weekStartDate) =>
    getEntriesForCell(null, weekStartDate)
      .concat(categories.flatMap((category) => getEntriesForCell(category.id, weekStartDate)))
      .reduce((sum, entry) => sum + Math.max(0, entry.amount), 0)
  );
  const maxSpend = Math.max(1, ...weeklySpend);

  const historySeries = netWorthHistory
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({
      date: entry.date,
      balance: entry.accounts.find((account) => account.id === activeAccountId)?.balance ?? 0
    }));

  const projectionByYear = new Map(
    projectionYears
      .slice()
      .sort((a, b) => a.calendarYear - b.calendarYear)
      .map((year) => [year.calendarYear, year.accountBalancesById[activeAccountId ?? ''] ?? 0])
  );

  const deriveWeeklyBalance = (week: string) => {
    const weekDate = parseIsoDate(week);
    if (!weekDate) {
      return 0;
    }
    const today = new Date();
    if (weekDate <= today) {
      const priorCandidates = historySeries.filter((item) => item.date <= week);
      const prior = priorCandidates.length > 0 ? priorCandidates[priorCandidates.length - 1] : undefined;
      return prior?.balance ?? (activeAccountId ? accountById.get(activeAccountId)?.balance ?? 0 : 0);
    }

    const year = weekDate.getFullYear();
    const thisYearBalance = projectionByYear.get(year);
    const nextYearBalance = projectionByYear.get(year + 1) ?? thisYearBalance;
    if (thisYearBalance === undefined) {
      return activeAccountId ? accountById.get(activeAccountId)?.balance ?? 0 : 0;
    }
    const fraction = Math.max(0, Math.min(1, (weekDate.getMonth() * 30 + weekDate.getDate()) / 365));
    return thisYearBalance + ((nextYearBalance ?? thisYearBalance) - thisYearBalance) * fraction;
  };

  const weeklyBalance = weekKeys.map((week) => deriveWeeklyBalance(week));
  const accountCurrentBalance = activeAccountId ? accountById.get(activeAccountId)?.balance ?? 0 : 0;
  const maxBalanceTarget = activeAccountId ? expenses.maxBalanceByAccountId[activeAccountId] ?? accountCurrentBalance : 0;
  const yMaxBalance = Math.max(1, maxBalanceTarget, accountCurrentBalance, ...weeklyBalance);
  const recurringPaymentAccountBalance =
    recurringDraft && recurringDraft.amount > 0
      ? accountById.get(recurringDraft.paymentAccountId || activeAccountId || '')?.balance ?? 0
      : 0;
  const recurringOccurrenceEstimate = weekKeys
    .map((week) =>
      resolveRecurringDates(
        {
          id: 'preview',
          label: recurringDraft.label,
          amount: recurringDraft.amount,
          accountId: activeAccountId ?? '',
          paymentAccountId: recurringDraft.paymentAccountId || activeAccountId || null,
          categoryId: categories[0]?.id ?? null,
          cadence: recurringDraft.cadence,
          rule: recurringDraft.rule,
          startDate: clampIsoDate(recurringDraft.startDate, minDate, maxDate),
          endDate: clampIsoDate(recurringDraft.endDate, minDate, maxDate),
          dayOfMonth: recurringDraft.dayOfMonth,
          anchorDate: recurringDraft.anchorDate,
          enabled: true
        },
        week
      ).length
    )
    .reduce((sum, count) => sum + count, 0);
  const recurringEstimatedTotal = recurringOccurrenceEstimate * Math.max(0, recurringDraft.amount);
  const recurringMayEmptyAccount = recurringEstimatedTotal > recurringPaymentAccountBalance;
  const selectedImport = selectedImportId ? expenses.imports.find((source) => source.id === selectedImportId) ?? null : null;

  return (
    <section className="panel expenses-panel">
      <div className="panel-title">Expenses</div>
      <div className="panel-body" onClick={() => setCellContextMenu(null)}>
        <div className="expense-toolbar">
          <button type="button" className="secondary-button" onClick={addManualExpense}>
            Add Event
          </button>
          <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>
            Import Expense Files
          </button>
          <input ref={fileInputRef} type="file" multiple accept=".csv,.pdf" style={{ display: 'none' }} onChange={onImportFiles} />
          {isImporting ? <span className="subtle">Importing...</span> : null}
        </div>

        <div className="expense-controls-grid">
          <label>
            <span>Planning Account</span>
            <select value={activeAccountId ?? ''} onChange={(event) => setActiveAccount(event.target.value)}>
              {bankAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Window Start</span>
            <input
              type="date"
              min={minDate}
              max={maxDate}
              value={expenses.ui.windowStartDate}
              onChange={(event) => {
                const nextStart = clampIsoDate(event.target.value, minDate, maxDate);
                const nextEnd = nextStart > expenses.ui.windowEndDate ? nextStart : expenses.ui.windowEndDate;
                updateUi({ windowStartDate: nextStart, windowEndDate: nextEnd });
              }}
            />
          </label>
          <label>
            <span>Window End</span>
            <input
              type="date"
              min={expenses.ui.windowStartDate || minDate}
              max={maxDate}
              value={expenses.ui.windowEndDate}
              onChange={(event) => updateUi({ windowEndDate: clampIsoDate(event.target.value, expenses.ui.windowStartDate || minDate, maxDate) })}
            />
          </label>
          <label>
            <span>Max Balance Line</span>
            <input
              type="number"
              min={0}
              value={maxBalanceTarget}
              onChange={(event) => {
                if (!activeAccountId) {
                  return;
                }
                updateExpenses({
                  maxBalanceByAccountId: {
                    ...expenses.maxBalanceByAccountId,
                    [activeAccountId]: Math.max(0, Number(event.target.value) || 0)
                  }
                });
              }}
            />
          </label>
        </div>

        <div className="expense-category-bar">
          <label>
            <span>Add Category</span>
            <input value={newCategoryLabel} onChange={(event) => setNewCategoryLabel(event.target.value)} placeholder="e.g. Groceries" />
          </label>
          <button type="button" className="secondary-button" onClick={addCategory}>
            Add Category
          </button>
          <span className="subtle">Last updated account balance: {formatCurrency(accountCurrentBalance)}</span>
        </div>

        <div className="expense-category-bar">
          <button type="button" className="secondary-button" onClick={() => setShowRecurringModal(true)}>
            Add Recurring Event
          </button>
          <button type="button" className="secondary-button" onClick={skipToToday}>
            Skip To Today
          </button>
        </div>
        {showRecurringModal ? (
          <div className="expense-modal-backdrop" onClick={() => setShowRecurringModal(false)}>
            <div className="expense-modal" onClick={(event) => event.stopPropagation()}>
              <h3>{editingRecurringEventId ? 'Edit Recurring Event' : 'New Recurring Event'}</h3>
              <label><span>Recurring Label</span><input value={recurringDraft.label} onChange={(e) => setRecurringDraft((c) => ({ ...c, label: e.target.value }))} /></label>
              <label><span>Amount</span><input type="number" value={recurringDraft.amount} onChange={(e) => setRecurringDraft((c) => ({ ...c, amount: Number(e.target.value) || 0 }))} /></label>
              <label>
                <span>Payment Account</span>
                <select
                  value={recurringDraft.paymentAccountId}
                  onChange={(e) => setRecurringDraft((c) => ({ ...c, paymentAccountId: e.target.value }))}
                >
                  {bankAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label}
                    </option>
                  ))}
                </select>
              </label>
              <label><span>Cadence</span><select value={recurringDraft.cadence} onChange={(e) => setRecurringDraft((c) => ({ ...c, cadence: e.target.value as 'weekly' | 'monthly' }))}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
              <label><span>Rule</span><select value={recurringDraft.rule} onChange={(e) => setRecurringDraft((c) => ({ ...c, rule: e.target.value as 'on_date' | 'every_friday' | 'first_monday_after' }))}><option value="on_date">Pays On Date</option><option value="every_friday">Every Friday</option><option value="first_monday_after">First Monday After Date</option></select></label>
              <label><span>Start Date</span><input type="date" value={recurringDraft.startDate} min={minDate} max={maxDate} onChange={(e) => setRecurringDraft((c) => ({ ...c, startDate: e.target.value }))} /></label>
              <label><span>End Date</span><input type="date" value={recurringDraft.endDate} min={recurringDraft.startDate || minDate} max={maxDate} onChange={(e) => setRecurringDraft((c) => ({ ...c, endDate: e.target.value }))} /></label>
              <label>
                <span>Event Color</span>
                <div className="expense-category-color-controls">
                  {RAINBOW_COLOR_PRESETS.map((preset) => (
                    <button
                      key={`recurring-color-${preset}`}
                      type="button"
                      className="expense-color-swatch"
                      style={{ backgroundColor: preset }}
                      onClick={() => setRecurringDraft((c) => ({ ...c, color: preset }))}
                    />
                  ))}
                  <input
                    type="color"
                    value={recurringDraft.color}
                    onChange={(e) => setRecurringDraft((c) => ({ ...c, color: e.target.value }))}
                  />
                </div>
              </label>
              {recurringMayEmptyAccount ? (
                <p className="subtle danger-text">
                  Warning: Estimated recurring payments ({formatCurrency(recurringEstimatedTotal)}) may exceed current account balance ({formatCurrency(recurringPaymentAccountBalance)}).
                </p>
              ) : null}
              <div className="expense-modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={editingRecurringEventId ? saveRecurringEventEdit : addRecurringEvent}
                >
                  {editingRecurringEventId ? 'Save Recurring Event' : 'Create Recurring Event'}
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setShowRecurringModal(false);
                    setEditingRecurringEventId(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {showOneTimeModal ? (
          <div className="expense-modal-backdrop" onClick={() => setShowOneTimeModal(false)}>
            <div className="expense-modal" onClick={(event) => event.stopPropagation()}>
              <h3>{editingOneTimeEventId ? 'Edit Event' : 'New Event'}</h3>
              <label>
                <span>Name</span>
                <input value={oneTimeDraft.label} onChange={(e) => setOneTimeDraft((c) => ({ ...c, label: e.target.value }))} />
              </label>
              <label>
                <span>Amount</span>
                <input type="number" value={oneTimeDraft.amount} onChange={(e) => setOneTimeDraft((c) => ({ ...c, amount: Number(e.target.value) || 0 }))} />
              </label>
              <label>
                <span>Date</span>
                <input type="date" value={oneTimeDraft.date} min={minDate} max={maxDate} onChange={(e) => setOneTimeDraft((c) => ({ ...c, date: e.target.value }))} />
              </label>
              <label>
                <span>Account</span>
                <select
                  value={oneTimeDraft.accountId}
                  onChange={(e) => {
                    const nextAccountId = e.target.value;
                    const nextCategoryId = (seededCategoriesByAccountId[nextAccountId] ?? [])[0]?.id ?? null;
                    setOneTimeDraft((c) => ({ ...c, accountId: nextAccountId, categoryId: nextCategoryId }));
                  }}
                >
                  {bankAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Category</span>
                <select
                  value={oneTimeDraft.categoryId ?? ''}
                  onChange={(e) => setOneTimeDraft((c) => ({ ...c, categoryId: e.target.value || null }))}
                >
                  <option value="">Uncategorized</option>
                  {(seededCategoriesByAccountId[oneTimeDraft.accountId] ?? []).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Event Color</span>
                <div className="expense-category-color-controls">
                  {RAINBOW_COLOR_PRESETS.map((preset) => (
                    <button
                      key={`one-time-color-${preset}`}
                      type="button"
                      className="expense-color-swatch"
                      style={{ backgroundColor: preset }}
                      onClick={() => setOneTimeDraft((c) => ({ ...c, color: preset }))}
                    />
                  ))}
                  <input
                    type="color"
                    value={oneTimeDraft.color}
                    onChange={(e) => setOneTimeDraft((c) => ({ ...c, color: e.target.value }))}
                  />
                </div>
              </label>
              <div className="expense-modal-actions">
                <button type="button" className="secondary-button" onClick={saveOneTimeEvent}>
                  {editingOneTimeEventId ? 'Save Event' : 'Create Event'}
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setShowOneTimeModal(false);
                    setEditingOneTimeEventId(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="expenses-weekly-grid-wrap">
          <div className="expenses-weekly-grid-shell" style={{ minWidth: `${shellWidth}px` }}>
          <div className="expenses-weekly-grid" style={{ minWidth: `${gridWidth}px`, gridTemplateColumns }}>
            <div className="expense-grid-header-cell expense-grid-category-header">Balance</div>
            {weekKeys.map((week, index) => (
              <div
                key={`balance-${week}`}
                className={`expense-grid-header-cell${(weeklyBalance[index] ?? 0) > maxBalanceTarget ? ' balance-over-max' : ''}`}
              >
                {formatCurrency(weeklyBalance[index] ?? 0)}
              </div>
            ))}

            <div className="expense-grid-header-cell expense-grid-category-header">Weeks From Today</div>
            {weekKeys.map((week) => {
              const dayDiff = Math.round(((parseIsoDate(week)?.getTime() ?? 0) - (parseIsoDate(todayIsoDate())?.getTime() ?? 0)) / (1000 * 60 * 60 * 24));
              const weeksFromToday = Math.max(0, Math.floor(dayDiff / 7));
              return (
                <div key={`week-offset-${week}`} className="expense-grid-header-cell">
                  +{weeksFromToday}w
                </div>
              );
            })}

            <div className="expense-grid-header-cell expense-grid-category-header">Category</div>
            {weekKeys.map((week) => (
              <div key={week} className="expense-grid-header-cell">{week}</div>
            ))}

            {categoryRows.map((category) => {
              const categoryId = category.categoryId;
              const rowHeight = category.rowHeight;
              return (
                <Fragment key={`row-${category.id}`}>
                  <div key={`label-${category.id}`} className="expense-grid-category-label" style={{ minHeight: `${rowHeight}px` }}>
                    <input
                      type="text"
                      value={category.label}
                      disabled={categoryId === null}
                      onChange={(event) => categoryId && renameCategory(categoryId, event.target.value)}
                    />
                    {categoryId ? (
                      <button type="button" className="text-button" onClick={() => removeCategory(categoryId)}>
                        Remove
                      </button>
                    ) : null}
                  </div>

                  {weekKeys.map((week) => {
                    const entries = getEntriesForCell(categoryId, week);
                    return (
                      <div
                        key={`${category.id}-${week}`}
                        className="expense-week-cell"
                        style={{ minHeight: `${rowHeight}px` }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setCellContextMenu({
                            x: event.clientX,
                            y: event.clientY,
                            weekStartDate: week,
                            categoryId,
                            entryId: undefined,
                            recurringEventId: undefined
                          });
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const entryId = event.dataTransfer.getData('text/expense-entry-id');
                          if (entryId && !entryId.startsWith('recurring-expense-')) {
                            onDropEntry(categoryId, week, entryId);
                          }
                        }}
                      >
                        {entries.map((entry) => (
                          <div
                            key={entry.id}
                            className="expense-week-card"
                            style={getEntryCardStyle((entry as { color?: string }).color)}
                            draggable={!entry.id.startsWith('recurring-expense-')}
                            onDragStart={(event) => {
                              event.dataTransfer.setData('text/expense-entry-id', entry.id);
                              event.dataTransfer.effectAllowed = 'move';
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setCellContextMenu({
                                x: event.clientX,
                                y: event.clientY,
                                weekStartDate: week,
                                categoryId,
                                entryId: !entry.id.startsWith('recurring-expense-') ? entry.id : undefined,
                                recurringEventId: (entry as { recurringEventId?: string }).recurringEventId
                              });
                            }}
                            onDoubleClick={() => {
                              if (entry.id.startsWith('recurring-expense-')) {
                                const recurringId = (entry as { recurringEventId?: string }).recurringEventId;
                                const recurringEvent = (expenses.recurringEvents ?? []).find((event) => event.id === recurringId);
                                if (!recurringEvent) {
                                  return;
                                }
                                setRecurringDraft({
                                  label: recurringEvent.label,
                                  amount: recurringEvent.amount,
                                  paymentAccountId: recurringEvent.paymentAccountId ?? recurringEvent.accountId,
                                  color: recurringEvent.color ?? '#3b82f6',
                                  cadence: recurringEvent.cadence,
                                  rule: recurringEvent.rule,
                                  startDate: recurringEvent.startDate,
                                  endDate: recurringEvent.endDate,
                                  dayOfMonth: recurringEvent.dayOfMonth ?? 1,
                                  anchorDate: recurringEvent.anchorDate ?? recurringEvent.startDate
                                });
                                setEditingRecurringEventId(recurringEvent.id);
                                setShowRecurringModal(true);
                                return;
                              }
                              const sourceEntry = expenses.entries.find((item) => item.id === entry.id);
                              if (!sourceEntry) {
                                return;
                              }
                              setOneTimeDraft({
                                label: sourceEntry.label,
                                amount: sourceEntry.amount,
                                date: sourceEntry.startDate,
                                accountId: sourceEntry.accountId ?? (activeAccountId ?? ''),
                                categoryId: sourceEntry.categoryId ?? null,
                                color: sourceEntry.color ?? '#3b82f6'
                              });
                              setEditingOneTimeEventId(sourceEntry.id);
                              setShowOneTimeModal(true);
                            }}
                          >
                            <span>{entry.label}</span>
                            <strong>{formatCurrency(entry.amount)}</strong>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
          </div>
        </div>
        {cellContextMenu ? (
          <div
            className="expense-cell-context-menu"
            style={{ left: `${cellContextMenu.x}px`, top: `${cellContextMenu.y}px` }}
            onClick={(event) => event.stopPropagation()}
          >
            {cellContextMenu.entryId || cellContextMenu.recurringEventId ? (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  if (cellContextMenu.entryId) {
                    const source = expenses.entries.find((entry) => entry.id === cellContextMenu.entryId);
                    if (source && source.accountId) {
                      setCopiedEvent({
                        kind: 'one_time',
                        label: source.label,
                        amount: source.amount,
                        accountId: source.accountId,
                        categoryId: source.categoryId ?? null,
                        color: source.color ?? '#3b82f6'
                      });
                    }
                  } else if (cellContextMenu.recurringEventId) {
                    const source = (expenses.recurringEvents ?? []).find((event) => event.id === cellContextMenu.recurringEventId);
                    if (source) {
                      setCopiedEvent({
                        kind: 'recurring',
                        label: source.label,
                        amount: source.amount,
                        accountId: source.accountId,
                        paymentAccountId: source.paymentAccountId ?? source.accountId,
                        categoryId: source.categoryId ?? null,
                        color: source.color ?? '#3b82f6',
                        cadence: source.cadence,
                        rule: source.rule,
                        dayOfMonth: source.dayOfMonth ?? 1,
                        anchorDate: source.anchorDate ?? source.startDate
                      });
                    }
                  }
                  setCellContextMenu(null);
                }}
              >
                Copy Event
              </button>
            ) : null}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                addManualExpenseAtCell(cellContextMenu.weekStartDate, cellContextMenu.categoryId);
                setCellContextMenu(null);
              }}
            >
              New Event
            </button>
            {copiedEvent ? (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  pasteEventAtCell(cellContextMenu.weekStartDate, cellContextMenu.categoryId);
                  setCellContextMenu(null);
                }}
              >
                Paste Event Here
              </button>
            ) : null}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                addRecurringEventAtCell(cellContextMenu.weekStartDate, cellContextMenu.categoryId);
                setCellContextMenu(null);
              }}
            >
              New Recurring Event
            </button>
            {cellContextMenu.entryId || cellContextMenu.recurringEventId ? (
              <button
                type="button"
                className="text-button expense-context-delete"
                onClick={() => {
                  deleteContextMenuEvent(cellContextMenu.entryId, cellContextMenu.recurringEventId);
                  setCellContextMenu(null);
                }}
              >
                Delete Event
              </button>
            ) : null}
          </div>
        ) : null}

        <h3>Expense History & Planner Entries</h3>
        <div className="table-wrap">
          <table className="purchases-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Amount</th>
                <th>Start</th>
                <th>End</th>
                <th>Category</th>
                <th>Account</th>
                <th>Pool</th>
                <th>Source</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {expenses.entries.map((entry) => {
                const entryAccountCategories = entry.accountId ? seededCategoriesByAccountId[entry.accountId] ?? [] : [];
                return (
                  <tr key={entry.id}>
                    <td><input type="text" value={entry.label} onChange={(event) => updateEntry(entry.id, { label: event.target.value })} /></td>
                    <td><input type="number" min={0} value={entry.amount} onChange={(event) => updateEntry(entry.id, { amount: Math.max(0, Number(event.target.value) || 0) })} /></td>
                    <td><input type="date" min={minDate} max={maxDate} value={entry.startDate} onChange={(event) => updateEntry(entry.id, { startDate: clampIsoDate(event.target.value, minDate, maxDate) })} /></td>
                    <td><input type="date" min={entry.startDate || minDate} max={maxDate} value={entry.endDate} onChange={(event) => updateEntry(entry.id, { endDate: clampIsoDate(event.target.value, entry.startDate || minDate, maxDate) })} /></td>
                    <td>
                      <select value={entry.categoryId ?? ''} onChange={(event) => updateEntry(entry.id, { categoryId: event.target.value || null })}>
                        <option value="">Uncategorized</option>
                        {entryAccountCategories.map((category) => (
                          <option key={category.id} value={category.id}>{category.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={entry.accountId ?? ''}
                        onChange={(event) => {
                          const accountId = event.target.value || null;
                          const account = accountId ? accountById.get(accountId) : null;
                          const firstCategoryId = accountId ? (seededCategoriesByAccountId[accountId] ?? [])[0]?.id ?? null : null;
                          updateEntry(entry.id, { accountId, poolId: account?.poolId ?? null, categoryId: firstCategoryId });
                        }}
                      >
                        <option value="">Unassigned</option>
                        {bankAccounts.map((account) => (
                          <option key={account.id} value={account.id}>{account.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>{entry.poolId ? poolById.get(entry.poolId)?.label ?? entry.poolId : 'Unassigned'}</td>
                    <td>{entry.originType === 'imported' ? `Import (${entry.importSourceId ?? 'unknown'})` : 'Manual'}</td>
                    <td><button type="button" className="text-button" onClick={() => removeEntry(entry.id)}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h3>Import Sources (Audit + Rollback)</h3>
        <div className="expense-toolbar">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setShowImportsModal(true);
              if (!selectedImportId && expenses.imports.length > 0) {
                setSelectedImportId(expenses.imports[0].id);
              }
            }}
            disabled={expenses.imports.length === 0}
          >
            Manage Imported Expenses
          </button>
        </div>
        {expenses.imports.length === 0 ? (
          <p className="subtle">No imported sources yet.</p>
        ) : (
          <div className="networth-import-list">
            {expenses.imports.map((source) => (
              <div key={source.id} className="networth-import-item">
                <div className="networth-import-item-row">
                  <div><strong>{source.fileName}</strong> ({source.fileType.toUpperCase()})</div>
                  <div>Status: <strong>{source.status}</strong></div>
                  <div>Entries: <strong>{source.entryIds.length}</strong></div>
                </div>
                <div className="networth-import-item-row">
                  <button type="button" className="secondary-button" onClick={() => applyImportSource(source.id)} disabled={source.status === 'applied'}>
                    Apply
                  </button>
                  <button type="button" className="text-button" onClick={() => removeImportSource(source.id)}>
                    Remove Source + Imported Entries
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setSelectedImportId(source.id);
                      setExpandedImportIds((current) => (current.includes(source.id) ? current : [...current, source.id]));
                      setShowImportsModal(true);
                    }}
                  >
                    Open In Popup
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {showImportsModal ? (
          <div className="expense-modal-backdrop" onClick={() => setShowImportsModal(false)}>
            <div className="expense-imports-modal" onClick={(event) => event.stopPropagation()}>
              <div className="expense-imports-modal-header">
                <h3>Imported Expense Documents</h3>
                <button type="button" className="text-button" onClick={() => setShowImportsModal(false)}>
                  Close
                </button>
              </div>
              <div className="expense-imports-modal-grid">
                <div className="expense-imports-documents">
                  {expenses.imports.map((source) => {
                    const isExpanded = expandedImportIds.includes(source.id);
                    return (
                      <div key={`modal-import-${source.id}`} className="expense-import-doc">
                        <div className="expense-import-doc-header">
                          <button type="button" className="text-button" onClick={() => toggleExpandedImport(source.id)}>
                            {isExpanded ? 'Collapse' : 'Expand'}
                          </button>
                          <button type="button" className="text-button" onClick={() => setSelectedImportId(source.id)}>
                            Select
                          </button>
                          <strong>{source.fileName}</strong>
                        </div>
                        {isExpanded ? (
                          source.fileType === 'csv' ? (
                            (() => {
                              const rows = parseCsvPreview(source.previewText || '');
                              if (rows.length === 0) {
                                return <pre className="expense-import-preview">No preview text available.</pre>;
                              }
                              const [headers, ...body] = rows;
                              return (
                                <div className="table-wrap expense-import-preview-table">
                                  <table className="purchases-table">
                                    <thead>
                                      <tr>
                                        {headers.map((header, index) => (
                                          <th key={`expense-preview-header-${source.id}-${index}`}>{header || `Column ${index + 1}`}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {body.map((row, rowIndex) => (
                                        <tr key={`expense-preview-row-${source.id}-${rowIndex}`}>
                                          {headers.map((_, colIndex) => (
                                            <td key={`expense-preview-cell-${source.id}-${rowIndex}-${colIndex}`}>{row[colIndex] ?? ''}</td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            })()
                          ) : (
                            <pre className="expense-import-preview">{source.previewText || 'No preview text available.'}</pre>
                          )
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className="expense-import-details">
                  {selectedImport ? (
                    <>
                      <h4>Details</h4>
                      <p><strong>File:</strong> {selectedImport.fileName}</p>
                      <p><strong>Type:</strong> {selectedImport.fileType.toUpperCase()}</p>
                      <p><strong>Batch:</strong> {selectedImport.batchId}</p>
                      <p><strong>Imported:</strong> {selectedImport.importedAt}</p>
                      <p><strong>Entries:</strong> {selectedImport.entryIds.length}</p>
                      <label>
                        <span>Status</span>
                        <select
                          value={selectedImport.status}
                          onChange={(event) =>
                            updateImportSource(selectedImport.id, {
                              status: event.target.value as ExpensesConfig['imports'][number]['status']
                            })
                          }
                        >
                          <option value="staged">Staged</option>
                          <option value="ready">Ready</option>
                          <option value="needs_review">Needs Review</option>
                          <option value="error">Error</option>
                          <option value="applied">Applied</option>
                        </select>
                      </label>
                      <label>
                        <span>Confidence</span>
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.01}
                          value={selectedImport.confidence}
                          onChange={(event) =>
                            updateImportSource(selectedImport.id, {
                              confidence: Math.min(1, Math.max(0, Number(event.target.value) || 0))
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>Parse Notes (one per line)</span>
                        <textarea
                          value={selectedImport.parseNotes.join('\n')}
                          onChange={(event) =>
                            updateImportSource(selectedImport.id, {
                              parseNotes: event.target.value
                                .split('\n')
                                .map((note) => note.trim())
                                .filter((note) => note.length > 0)
                            })
                          }
                          rows={7}
                        />
                      </label>
                      <div className="expense-modal-actions">
                        <button type="button" className="secondary-button" onClick={() => applyImportSource(selectedImport.id)} disabled={selectedImport.status === 'applied'}>
                          Apply
                        </button>
                        <button type="button" className="text-button expense-context-delete" onClick={() => removeImportSource(selectedImport.id)}>
                          Remove Source + Imported Entries
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="subtle">Select an imported document to view and configure details.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
};
