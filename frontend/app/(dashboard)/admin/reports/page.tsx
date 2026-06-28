'use client';

import { useState, useEffect, useRef } from 'react';
import { useSubmitShortcut } from '@/app/lib/useSubmitShortcut';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, MoreHorizontal, Pencil, Trash2, Power, PowerOff, Send, FlaskConical, Clock } from 'lucide-react';
import { DataTable, Tooltip } from '@/app/components/DataTable';
import {
  getReports,
  createReport,
  updateReport,
  deleteReport,
  activateReport,
  deactivateReport,
  sendTestReport,
  sendReportNow,
  getReportSettings,
  updateReportSettings,
  type Report,
  type ReportSetting,
} from '@/app/lib/api';
import { formatDateTime } from '@/app/lib/date';
import { toast } from 'sonner';
import { useConfirm } from '@/app/components/ConfirmDialog';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// "06:00:00" -> "06:00" (for <input type="time">)
const fmtTime = (hms: string | null | undefined) => (hms ?? '').slice(0, 5);
const scheduleLabel = (weekday: number, time: string) =>
  `${WEEKDAYS[weekday] ?? '?'} ${fmtTime(time)}`;

// Split a free-text email list (commas / semicolons / newlines / spaces) into a
// deduped array. Email addresses never contain whitespace, so this is safe.
function parseRecipients(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[\s,;]+/)) {
    const email = piece.trim().toLowerCase();
    if (email && !seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

export default function ReportsPage() {
  const confirm = useConfirm();
  const [reports, setReports] = useState<Report[]>([]);
  const [settings, setSettings] = useState<ReportSetting | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const [error, setError] = useState('');

  // Pagination state
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const fetchReports = async () => {
    setIsLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('page_size', String(pageSize));
    const result = await getReports(params);
    if (result.data) {
      setReports(result.data.results || []);
      setTotalCount(result.data.count || 0);
    }
    setIsLoading(false);
  };

  const fetchSettings = async () => {
    const result = await getReportSettings();
    if (result.data) setSettings(result.data);
  };

  useEffect(() => {
    fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async (formData: Partial<Report>) => {
    setError('');
    if (editingReport) {
      const result = await updateReport(editingReport.id, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
    } else {
      const result = await createReport(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
    }
    setIsModalOpen(false);
    setEditingReport(null);
    fetchReports();
  };

  const handleDelete = async (report: Report) => {
    const ok = await confirm({
      title: 'Delete report?',
      description: `Are you sure you want to delete "${report.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const result = await deleteReport(report.id);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success('Report deleted');
      fetchReports();
    }
  };

  const handleToggleActive = async (report: Report) => {
    const result = report.is_active
      ? await deactivateReport(report.id)
      : await activateReport(report.id);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(report.is_active ? 'Report deactivated' : 'Report activated');
      fetchReports();
    }
  };

  const handleSendTest = async (report: Report) => {
    const result = await sendTestReport(report.id);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(result.data?.message || 'Test digest sent to your email');
    }
  };

  const handleSendNow = async (report: Report) => {
    const count = report.recipients.length;
    if (count === 0) {
      toast.error('This report has no recipients.');
      return;
    }
    const ok = await confirm({
      title: 'Send to all recipients now?',
      description: `This emails the Sales Weekly Digest to ${count} recipient${count === 1 ? '' : 's'} immediately.`,
      confirmLabel: 'Send now',
    });
    if (!ok) return;
    const result = await sendReportNow(report.id);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(result.data?.message || 'Digest sent to recipients');
      fetchReports();
    }
  };

  const renderSchedule = (report: Report) => {
    const isCustom = report.send_weekday !== null || report.send_time !== null;
    if (isCustom) {
      const wd = report.send_weekday ?? settings?.default_send_weekday ?? 0;
      const tm = report.send_time ?? settings?.default_send_time ?? '06:00:00';
      return <span>{scheduleLabel(wd, tm)}</span>;
    }
    return (
      <span className="text-muted-foreground">
        {settings
          ? `Default (${scheduleLabel(settings.default_send_weekday, settings.default_send_time)})`
          : 'Default'}
      </span>
    );
  };

  const columns = [
    { key: 'id', header: 'ID' },
    {
      key: 'name',
      header: 'Name',
      render: (report: Report) => <span className="font-medium">{report.name}</span>,
    },
    {
      key: 'recipients',
      header: 'Email List',
      render: (report: Report) =>
        report.recipients.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Tooltip text={report.recipients.join(', ')}>
            <span className="cursor-help underline decoration-dotted">
              {report.recipients.length} recipient{report.recipients.length === 1 ? '' : 's'}
            </span>
          </Tooltip>
        ),
    },
    {
      key: 'schedule',
      header: 'Schedule',
      render: renderSchedule,
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (report: Report) => (
        <Badge variant={report.is_active ? 'default' : 'destructive'}>
          {report.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'last_sent_at',
      header: 'Last Sent',
      render: (report: Report) =>
        report.last_sent_at ? formatDateTime(report.last_sent_at) : 'Never',
    },
    {
      key: 'actions',
      header: '',
      render: (report: Report) => (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setEditingReport(report);
                  setError('');
                  setIsModalOpen(true);
                }}
              >
                <Pencil className="h-4 w-4 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleToggleActive(report)}>
                {report.is_active ? (
                  <>
                    <PowerOff className="h-4 w-4 mr-2" /> Deactivate
                  </>
                ) : (
                  <>
                    <Power className="h-4 w-4 mr-2" /> Activate
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSendNow(report)}>
                <Send className="h-4 w-4 mr-2" /> Send now
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSendTest(report)}>
                <FlaskConical className="h-4 w-4 mr-2" /> Send test (to me)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleDelete(report)}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales Report</h1>
          <p className="text-muted-foreground">
            Configure recipients and schedule for the automated Sales Weekly Digest
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setIsScheduleOpen(true)}>
            <Clock className="h-4 w-4 mr-2" /> Default schedule
          </Button>
          <Button
            onClick={() => {
              setEditingReport(null);
              setError('');
              setIsModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" /> Add Report
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={reports}
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        isLoading={isLoading}
        height="h-[calc(100vh-220px)]"
      />

      <Dialog
        open={isModalOpen}
        onOpenChange={() => {
          setIsModalOpen(false);
          setEditingReport(null);
          setError('');
        }}
      >
        <DialogContent className="p-0 max-h-[90vh] flex flex-col">
          <DialogHeader className="border-b border-[#E4E4E4] p-4 shrink-0">
            <DialogTitle>{editingReport ? 'Edit Report' : 'Add New Report'}</DialogTitle>
          </DialogHeader>
          <ReportForm
            report={editingReport}
            defaultSchedule={settings}
            onSave={handleSave}
            onClose={() => setIsModalOpen(false)}
            error={error}
          />
        </DialogContent>
      </Dialog>

      <DefaultScheduleDialog
        open={isScheduleOpen}
        onOpenChange={setIsScheduleOpen}
        settings={settings}
        onSaved={fetchSettings}
      />
    </div>
  );
}

function ScheduleFields({
  weekday,
  time,
  onWeekdayChange,
  onTimeChange,
}: {
  weekday: number;
  time: string;
  onWeekdayChange: (v: number) => void;
  onTimeChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-2">
        <Label>Day</Label>
        <Select value={String(weekday)} onValueChange={(v) => onWeekdayChange(Number(v))}>
          <SelectTrigger className="w-full shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WEEKDAYS.map((d, i) => (
              <SelectItem key={i} value={String(i)}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Time</Label>
        <Input type="time" value={time} onChange={(e) => onTimeChange(e.target.value)} />
      </div>
    </div>
  );
}

function ReportForm({
  report,
  defaultSchedule,
  onSave,
  onClose,
  error,
}: {
  report: Report | null;
  defaultSchedule: ReportSetting | null;
  onSave: (data: Partial<Report>) => void;
  onClose: () => void;
  error: string;
}) {
  const buildInitial = (r: Report | null) => ({
    name: r?.name ?? '',
    subject: r?.subject ?? 'Sales Weekly Digest - System Generated',
    recipientsText: (r?.recipients ?? []).join('\n'),
    is_active: r?.is_active ?? false,
    useCustomSchedule: r != null && (r.send_weekday !== null || r.send_time !== null),
    send_weekday: r?.send_weekday ?? 0,
    send_time: fmtTime(r?.send_time) || '06:00',
  });

  const [formData, setFormData] = useState(() => buildInitial(report));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitShortcut(formRef);

  useEffect(() => {
    setFormData(buildInitial(report));
  }, [report]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await onSave({
      name: formData.name,
      subject: formData.subject,
      recipients: parseRecipients(formData.recipientsText),
      is_active: formData.is_active,
      send_weekday: formData.useCustomSchedule ? formData.send_weekday : null,
      send_time: formData.useCustomSchedule ? formData.send_time : null,
    });
    setIsSubmitting(false);
  };

  const recipientCount = parseRecipients(formData.recipientsText).length;
  const defaultLabel = defaultSchedule
    ? scheduleLabel(defaultSchedule.default_send_weekday, defaultSchedule.default_send_time)
    : 'the global default';

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
      <div className="space-y-4 px-4 py-4 overflow-y-auto flex-1 min-h-0">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
            {error}
          </div>
        )}
        <div className="space-y-2">
          <Label>Name</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Sales Weekly Digest"
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Email Subject</Label>
          <Input
            value={formData.subject}
            onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
            placeholder="Sales Weekly Digest - System Generated"
          />
          <p className="text-xs text-muted-foreground">
            The subject line recipients see. Leave blank to use the default.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Email List</Label>
          <Textarea
            value={formData.recipientsText}
            onChange={(e) => setFormData({ ...formData, recipientsText: e.target.value })}
            placeholder={'one@example.com\ntwo@example.com'}
            rows={6}
          />
          <p className="text-xs text-muted-foreground">
            Separate addresses with a comma, semicolon, space, or new line.
            {recipientCount > 0 && ` ${recipientCount} recipient${recipientCount === 1 ? '' : 's'}.`}
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="useCustomSchedule"
              checked={formData.useCustomSchedule}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, useCustomSchedule: !!checked })
              }
            />
            <Label htmlFor="useCustomSchedule">Use a custom schedule for this report</Label>
          </div>
          {formData.useCustomSchedule ? (
            <ScheduleFields
              weekday={formData.send_weekday}
              time={formData.send_time}
              onWeekdayChange={(v) => setFormData({ ...formData, send_weekday: v })}
              onTimeChange={(v) => setFormData({ ...formData, send_time: v })}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Uses the global default schedule ({defaultLabel}).
            </p>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox
            id="is_active"
            checked={formData.is_active}
            onCheckedChange={(checked) => setFormData({ ...formData, is_active: !!checked })}
          />
          <Label htmlFor="is_active">Active (send on the schedule)</Label>
        </div>
      </div>
      <DialogFooter className="p-4 border-t border-[#E4E4E4] shrink-0">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : report ? 'Update' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DefaultScheduleDialog({
  open,
  onOpenChange,
  settings,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ReportSetting | null;
  onSaved: () => void;
}) {
  const [weekday, setWeekday] = useState(0);
  const [time, setTime] = useState('06:00');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open && settings) {
      setWeekday(settings.default_send_weekday);
      setTime(fmtTime(settings.default_send_time) || '06:00');
    }
  }, [open, settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const result = await updateReportSettings({
      default_send_weekday: weekday,
      default_send_time: time,
    });
    setIsSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Default schedule updated');
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 flex flex-col">
        <DialogHeader className="border-b border-[#E4E4E4] p-4 shrink-0">
          <DialogTitle>Default send schedule</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="space-y-4 px-4 py-4">
            <p className="text-sm text-muted-foreground">
              Applies to every report that doesn&apos;t set its own schedule.
            </p>
            <ScheduleFields
              weekday={weekday}
              time={time}
              onWeekdayChange={setWeekday}
              onTimeChange={setTime}
            />
          </div>
          <DialogFooter className="p-4 border-t border-[#E4E4E4] shrink-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
