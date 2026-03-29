'use client';

import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronsUpDown, Info } from 'lucide-react';

export function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.top - 8, left: rect.left + rect.width / 2 });
    }
    setVisible(true);
  }, []);

  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={() => setVisible(false)} className="inline-flex">
      {children}
      {visible && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed px-2 py-1 text-xs font-normal text-white bg-[#09090B] rounded-md whitespace-nowrap pointer-events-none"
          style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)', zIndex: 99999 }}
        >
          {text}
        </div>,
        document.body
      )}
    </span>
  );
}

interface Column<T> {
  key: keyof T | string;
  header: string;
  tooltip?: string;
  minWidth?: string;
  render?: (item: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onEdit?: (item: T) => void;
  onDelete?: (item: T) => void;
  canEdit?: (item: T) => boolean;
  isLoading?: boolean;
  height?: string;
}

export function DataTable<T extends { id: number }>({
  columns,
  data,
  totalCount,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onEdit,
  onDelete,
  canEdit,
  isLoading,
  height = 'h-[calc(100vh-270px)]',
}: DataTableProps<T>) {
  const totalPages = Math.ceil(totalCount / pageSize);

  const getValue = (item: T, key: string): React.ReactNode => {
    const keys = key.split('.');
    let value: unknown = item;
    for (const k of keys) {
      value = (value as Record<string, unknown>)?.[k];
    }
    return value as React.ReactNode;
  };

  return (
    <div className={`bg-white border border-[#E4E4E4] rounded-2xl ${height}`}>
      <div className="p-3 flex flex-col h-full">
        {/* Table */}
        <div className="flex-1 min-h-0 rounded-lg overflow-auto">
          <table className="w-full min-w-max border-collapse">
            {/* Table Header */}
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F3F3F3] h-12">
                {columns.map((col) => (
                  <th
                    key={col.key as string}
                    className="px-5 text-left text-[#71717A] font-medium text-sm whitespace-nowrap"
                    style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                  >
                    <div className="flex items-center gap-1">
                      <span>{col.header}</span>
                      {col.tooltip && (
                        <Tooltip text={col.tooltip}>
                          <Info className="h-3 w-3 text-[#71717A] cursor-help" />
                        </Tooltip>
                      )}
                    </div>
                  </th>
                ))}
                {(onEdit || onDelete) && (
                  <th className="px-3 text-left text-[#71717A] font-medium text-sm w-[100px] sticky right-0 bg-[#F3F3F3]">
                    Actions
                  </th>
                )}
              </tr>
            </thead>

            {/* Table Body */}
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={columns.length + (onEdit || onDelete ? 1 : 0)} className="h-16 border-b border-[#EDEDED] text-center">
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
                      <span className="ml-2 text-[#71717A]">Loading...</span>
                    </div>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + (onEdit || onDelete ? 1 : 0)} className="h-16 border-b border-[#EDEDED] text-center text-[#71717A]">
                    No entries yet
                  </td>
                </tr>
              ) : (
                data.map((item) => (
                  <tr key={item.id} className="h-16 border-b border-[#EDEDED]">
                    {columns.map((col) => (
                      <td
                        key={col.key as string}
                        className="px-5 py-4 text-[#303030] text-sm font-medium whitespace-nowrap"
                      >
                        {col.render ? col.render(item) : getValue(item, col.key as string)}
                      </td>
                    ))}
                    {(onEdit || onDelete) && (
                      <td className="px-3 py-4 w-[100px] sticky right-0 bg-white">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-100">
                              <MoreHorizontal className="h-4 w-4 text-[#09090B]" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-[149px] bg-white border border-[#D4D4D4] rounded-lg p-0.5 shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.1)] flex flex-col gap-2"
                          >
                            {onEdit && (!canEdit || canEdit(item)) && (
                              <DropdownMenuItem
                                onClick={() => onEdit(item)}
                                className="cursor-pointer px-3 py-2 text-sm text-[#09090B] hover:bg-[#F3F3F3] rounded-md"
                              >
                                Edit
                              </DropdownMenuItem>
                            )}
                            {onDelete && (
                              <DropdownMenuItem
                                onClick={() => onDelete(item)}
                                className="cursor-pointer px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-md"
                              >
                                Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex justify-between items-center flex-shrink-0 pt-5">
          {/* Rows per page */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#09090B]">Rows per page</span>
            <div className="relative">
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="appearance-none w-[72px] h-8 px-3 pr-8 text-xs text-[#09090B] bg-white border border-[#E4E4E7] rounded-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-200"
              >
                {[10, 20, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[#09090B] opacity-50 pointer-events-none" />
            </div>
          </div>

          {/* Page info */}
          <div className="text-sm font-medium text-[#09090B]">
            Page {page} of {totalPages || 1}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(1)}
              disabled={page <= 1}
              className="flex items-center justify-center w-8 h-8 bg-white border border-[#E4E4E7] rounded-md disabled:opacity-50 hover:bg-gray-50 disabled:hover:bg-white"
            >
              <ChevronsLeft className="h-4 w-4 text-[#09090B]" />
            </button>
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="flex items-center justify-center w-8 h-8 bg-white border border-[#E4E4E7] rounded-md disabled:opacity-50 hover:bg-gray-50 disabled:hover:bg-white"
            >
              <ChevronLeft className="h-4 w-4 text-[#09090B]" />
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="flex items-center justify-center w-8 h-8 bg-white border border-[#E4E4E7] rounded-md disabled:opacity-50 hover:bg-gray-50 disabled:hover:bg-white"
            >
              <ChevronRight className="h-4 w-4 text-[#09090B]" />
            </button>
            <button
              onClick={() => onPageChange(totalPages)}
              disabled={page >= totalPages}
              className="flex items-center justify-center w-8 h-8 bg-white border border-[#E4E4E7] rounded-md disabled:opacity-50 hover:bg-gray-50 disabled:hover:bg-white"
            >
              <ChevronsRight className="h-4 w-4 text-[#09090B]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
