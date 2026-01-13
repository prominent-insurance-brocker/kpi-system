'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import {
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  type RoleFull,
  type ModuleInfo,
} from '@/app/lib/api';

interface ModuleCategory {
  name: string;
  modules: ModuleInfo[];
}

const MODULE_CATEGORIES: ModuleCategory[] = [
  {
    name: 'General',
    modules: [
      { key: 'general_new', label: 'General New' },
      { key: 'general_renewal', label: 'General Renewal' },
      { key: 'general_claim', label: 'General Claim' },
    ],
  },
  {
    name: 'Motor',
    modules: [
      { key: 'motor_new', label: 'Motor New' },
      { key: 'motor_renewal', label: 'Motor Renewal' },
      { key: 'motor_claim', label: 'Motor Claim' },
    ],
  },
];

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleFull[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleFull | null>(null);
  const [error, setError] = useState('');

  const fetchRoles = async () => {
    setIsLoading(true);
    const result = await getRoles();
    if (result.data) {
      setRoles(result.data.results || []);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  const handleSave = async (formData: {
    name: string;
    description: string;
    data_visibility: 'all' | 'own';
    module_permissions: string[];
  }) => {
    setError('');
    if (editingRole) {
      const result = await updateRole(editingRole.id, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
    } else {
      const result = await createRole(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
    }
    setIsModalOpen(false);
    setEditingRole(null);
    fetchRoles();
  };

  const handleDelete = async (role: RoleFull) => {
    if (role.user_count > 0) {
      alert(`Cannot delete role. ${role.user_count} user(s) are assigned to this role.`);
      return;
    }
    if (!confirm(`Are you sure you want to delete "${role.name}"?`)) return;
    const result = await deleteRole(role.id);
    if (result.error) {
      alert(result.error);
    } else {
      fetchRoles();
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Roles</h1>
          <p className="text-muted-foreground">Manage roles and permissions</p>
        </div>
        <Button
          onClick={() => {
            setEditingRole(null);
            setError('');
            setIsModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> Add Role
        </Button>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Data Access</TableHead>
              <TableHead>Modules</TableHead>
              <TableHead>Users</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : roles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No roles found
                </TableCell>
              </TableRow>
            ) : (
              roles.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-medium">{role.name}</TableCell>
                  <TableCell className="max-w-xs truncate">{role.description || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={role.data_visibility === 'all' ? 'default' : 'secondary'}>
                      {role.data_visibility === 'all' ? 'All Data' : 'Own Data'}
                    </Badge>
                  </TableCell>
                  <TableCell>{role.permissions.length}</TableCell>
                  <TableCell>{role.user_count}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setEditingRole(role);
                            setError('');
                            setIsModalOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDelete(role)}
                          className="text-destructive"
                          disabled={role.user_count > 0}
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={isModalOpen}
        onOpenChange={() => {
          setIsModalOpen(false);
          setEditingRole(null);
          setError('');
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingRole ? 'Edit Role' : 'Add New Role'}</DialogTitle>
          </DialogHeader>
          <RoleForm
            role={editingRole}
            onSave={handleSave}
            onClose={() => setIsModalOpen(false)}
            error={error}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleForm({
  role,
  onSave,
  onClose,
  error,
}: {
  role: RoleFull | null;
  onSave: (data: {
    name: string;
    description: string;
    data_visibility: 'all' | 'own';
    module_permissions: string[];
  }) => void;
  onClose: () => void;
  error: string;
}) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    data_visibility: 'own' as 'all' | 'own',
    module_permissions: [] as string[],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (role) {
      setFormData({
        name: role.name,
        description: role.description || '',
        data_visibility: role.data_visibility,
        module_permissions: role.permissions.map((p) => p.module),
      });
    } else {
      setFormData({
        name: '',
        description: '',
        data_visibility: 'own',
        module_permissions: [],
      });
    }
  }, [role]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await onSave(formData);
    setIsSubmitting(false);
  };

  const toggleModule = (moduleKey: string) => {
    setFormData((prev) => ({
      ...prev,
      module_permissions: prev.module_permissions.includes(moduleKey)
        ? prev.module_permissions.filter((m) => m !== moduleKey)
        : [...prev.module_permissions, moduleKey],
    }));
  };

  const toggleCategory = (category: ModuleCategory) => {
    const categoryModules = category.modules.map((m) => m.key);
    const allSelected = categoryModules.every((m) => formData.module_permissions.includes(m));

    if (allSelected) {
      // Remove all modules in this category
      setFormData((prev) => ({
        ...prev,
        module_permissions: prev.module_permissions.filter((m) => !categoryModules.includes(m)),
      }));
    } else {
      // Add all modules in this category
      setFormData((prev) => ({
        ...prev,
        module_permissions: [...new Set([...prev.module_permissions, ...categoryModules])],
      }));
    }
  };

  const getCategoryState = (category: ModuleCategory): 'all' | 'some' | 'none' => {
    const categoryModules = category.modules.map((m) => m.key);
    const selectedCount = categoryModules.filter((m) =>
      formData.module_permissions.includes(m)
    ).length;

    if (selectedCount === 0) return 'none';
    if (selectedCount === categoryModules.length) return 'all';
    return 'some';
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label>Role Name</Label>
        <Input
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
          placeholder="e.g., Data Entry Operator"
        />
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Brief description of this role..."
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label>Data Visibility</Label>
        <RadioGroup
          value={formData.data_visibility}
          onValueChange={(value: 'all' | 'own') =>
            setFormData({ ...formData, data_visibility: value })
          }
          className="flex gap-6 mt-2"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="own" id="own" />
            <Label htmlFor="own" className="font-normal">
              Own data only
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="all" id="all" />
            <Label htmlFor="all" className="font-normal">
              All data
            </Label>
          </div>
        </RadioGroup>
      </div>

      <div>
        <Label className="mb-3 block">Module Permissions</Label>
        <div className="border rounded-lg p-4 space-y-4">
          {MODULE_CATEGORIES.map((category) => {
            const state = getCategoryState(category);
            return (
              <div key={category.name} className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={category.name}
                    checked={state === 'all'}
                    onCheckedChange={() => toggleCategory(category)}
                    className={state === 'some' ? 'data-[state=checked]:bg-primary/50' : ''}
                    data-state={state === 'some' ? 'indeterminate' : state === 'all' ? 'checked' : 'unchecked'}
                  />
                  <Label htmlFor={category.name} className="font-medium cursor-pointer">
                    {category.name}
                  </Label>
                </div>
                <div className="ml-6 space-y-2">
                  {category.modules.map((module) => (
                    <div key={module.key} className="flex items-center space-x-2">
                      <Checkbox
                        id={module.key}
                        checked={formData.module_permissions.includes(module.key)}
                        onCheckedChange={() => toggleModule(module.key)}
                      />
                      <Label htmlFor={module.key} className="font-normal cursor-pointer">
                        {module.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : role ? 'Update' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  );
}
