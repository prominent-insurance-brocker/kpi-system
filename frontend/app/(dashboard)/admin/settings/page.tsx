'use client';

/**
 * Settings — admin-only page for managing lookup tables used elsewhere in
 * the app (Type of Accident + Insurance Company for Motor Claim).
 *
 * Non-admin users are redirected away on mount.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Pencil, Plus, Check, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/app/context/AuthContext';
import { firstAccessibleRoute } from '@/app/lib/navigation';
import {
  getAccidentTypes,
  getInsuranceCompanies,
  getClassOfInsurance,
  createAccidentType,
  createInsuranceCompany,
  createClassOfInsurance,
  updateAccidentType,
  updateInsuranceCompany,
  updateClassOfInsurance,
  type SettingsLookup,
  type ApiResponse,
} from '@/app/lib/api';

type LookupResource = 'accident-types' | 'insurance-companies' | 'class-of-insurance';

interface LookupResourceConfig {
  list: (params?: { is_active?: boolean }) => Promise<ApiResponse<SettingsLookup[]>>;
  create: (name: string) => Promise<ApiResponse<SettingsLookup>>;
  update: (
    id: number,
    data: { name?: string; is_active?: boolean }
  ) => Promise<ApiResponse<SettingsLookup>>;
  singularLabel: string;
  pluralLabel: string;
}

const RESOURCES: Record<LookupResource, LookupResourceConfig> = {
  'accident-types': {
    list: getAccidentTypes,
    create: createAccidentType,
    update: updateAccidentType,
    singularLabel: 'Accident Type',
    pluralLabel: 'Type of Accident',
  },
  'insurance-companies': {
    list: getInsuranceCompanies,
    create: createInsuranceCompany,
    update: updateInsuranceCompany,
    singularLabel: 'Insurance Company',
    pluralLabel: 'Insurance Company',
  },
  'class-of-insurance': {
    list: getClassOfInsurance,
    create: createClassOfInsurance,
    update: updateClassOfInsurance,
    singularLabel: 'Class of Insurance',
    pluralLabel: 'Class of Insurance',
  },
};

export default function SettingsPage() {
  const router = useRouter();
  const { user, isLoading, canSeeAllData } = useAuth();

  // Gate non-admin users away from the page.
  useEffect(() => {
    if (isLoading) return;
    if (!user || !canSeeAllData()) {
      router.replace(firstAccessibleRoute(user) ?? '/login');
    }
  }, [isLoading, user, canSeeAllData, router]);

  if (isLoading || !user || !canSeeAllData()) {
    return null;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage the lookup lists used elsewhere in the app.
        </p>
      </div>

      <Tabs defaultValue="accident-types">
        <TabsList className="bg-[#F3F4F6] rounded-lg p-1 gap-0 w-fit">
          <TabsTrigger
            value="accident-types"
            className="rounded-md px-4 py-1.5 data-[state=active]:bg-white"
          >
            Type of Accident
          </TabsTrigger>
          <TabsTrigger
            value="insurance-companies"
            className="rounded-md px-4 py-1.5 data-[state=active]:bg-white"
          >
            Insurance Company
          </TabsTrigger>
          <TabsTrigger
            value="class-of-insurance"
            className="rounded-md px-4 py-1.5 data-[state=active]:bg-white"
          >
            Class of Insurance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accident-types" className="mt-4">
          <LookupTab resource="accident-types" />
        </TabsContent>
        <TabsContent value="insurance-companies" className="mt-4">
          <LookupTab resource="insurance-companies" />
        </TabsContent>
        <TabsContent value="class-of-insurance" className="mt-4">
          <LookupTab resource="class-of-insurance" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LookupTab({ resource }: { resource: LookupResource }) {
  const config = RESOURCES[resource];
  const [rows, setRows] = useState<SettingsLookup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const reload = useCallback(async () => {
    setIsLoading(true);
    const result = await config.list();
    setRows(result.data ?? []);
    setIsLoading(false);
  }, [config]);

  useEffect(() => {
    reload();
  }, [reload]);

  const addRow = async () => {
    const cleaned = newName.trim();
    if (!cleaned) return;
    setIsSubmitting(true);
    const result = await config.create(cleaned);
    setIsSubmitting(false);
    if (result.data) {
      toast.success(`${config.singularLabel} added`);
      setIsAddOpen(false);
      setNewName('');
      reload();
    } else {
      toast.error(result.error || `Failed to add ${config.singularLabel.toLowerCase()}`);
    }
  };

  const saveEdit = async (id: number) => {
    const cleaned = editingValue.trim();
    if (!cleaned) return;
    const result = await config.update(id, { name: cleaned });
    if (result.data) {
      toast.success('Updated');
      setEditingId(null);
      reload();
    } else {
      toast.error(result.error || 'Failed to update');
    }
  };

  const toggleActive = async (row: SettingsLookup) => {
    const result = await config.update(row.id, { is_active: !row.is_active });
    if (result.data) {
      toast.success(row.is_active ? 'Deactivated' : 'Reactivated');
      reload();
    } else {
      toast.error(result.error || 'Failed to update');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{config.pluralLabel}</h2>
        <Button onClick={() => { setNewName(''); setIsAddOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Add {config.singularLabel}
        </Button>
      </div>

      <div className="bg-white border border-[#E4E4E4] rounded-2xl overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#F3F3F3] h-11">
              <th className="px-5 text-left text-sm font-medium text-[#71717A]">Name</th>
              <th className="px-5 text-left text-sm font-medium text-[#71717A] w-32">Status</th>
              <th className="px-5 text-right text-sm font-medium text-[#71717A] w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={3} className="h-16 text-center text-[#71717A]">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="h-16 text-center text-[#71717A]">
                  No {config.pluralLabel.toLowerCase()} configured yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isEditing = editingId === row.id;
                return (
                  <tr
                    key={row.id}
                    className="h-14 border-t border-[#EDEDED]"
                  >
                    <td className="px-5">
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              saveEdit(row.id);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditingId(null);
                            }
                          }}
                          className="max-w-sm"
                        />
                      ) : (
                        <span className={!row.is_active ? 'text-muted-foreground' : ''}>
                          {row.name}
                        </span>
                      )}
                    </td>
                    <td className="px-5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          row.is_active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {row.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 text-right">
                      <div className="inline-flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingId(null)}
                            >
                              <XIcon className="h-3 w-3 mr-1" /> Cancel
                            </Button>
                            <Button type="button" size="sm" onClick={() => saveEdit(row.id)}>
                              <Check className="h-3 w-3 mr-1" /> Save
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingId(row.id);
                                setEditingValue(row.name);
                              }}
                            >
                              <Pencil className="h-3 w-3 mr-1" /> Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => toggleActive(row)}
                            >
                              {row.is_active ? 'Deactivate' : 'Reactivate'}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={isAddOpen} onOpenChange={(open) => { if (!open) setIsAddOpen(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add {config.singularLabel}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addRow();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={`e.g. ${
                  resource === 'accident-types'
                    ? 'Hailstorm'
                    : resource === 'insurance-companies'
                      ? 'GoldStar Insurance'
                      : 'Marine Cargo Insurance'
                }`}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !newName.trim()}>
                {isSubmitting ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
