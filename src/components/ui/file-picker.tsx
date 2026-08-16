"use client";

import { useRef, useState } from "react";
import { FileArchive, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FilePicker({
  file,
  onFileChange,
  accept,
  browseLabel = "选择文件",
  emptyLabel = "尚未选择文件",
  helperText,
  maxBytes,
  disabled = false,
  className,
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  accept?: string;
  browseLabel?: string;
  emptyLabel?: string;
  helperText?: string;
  maxBytes?: number;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState("");

  function clearFile() {
    if (inputRef.current) inputRef.current.value = "";
    setValidationError("");
    onFileChange(null);
  }

  return (
    <div className={cn("rounded-md border border-dashed bg-muted/25 p-3", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const nextFile = event.target.files?.[0] || null;
          if (nextFile && maxBytes && nextFile.size > maxBytes) {
            event.target.value = "";
            setValidationError(`文件不能超过 ${formatFileSize(maxBytes)}`);
            onFileChange(null);
            return;
          }
          setValidationError("");
          onFileChange(nextFile);
        }}
        tabIndex={-1}
      />
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground">
          {file ? <FileArchive size={17} /> : <UploadCloud size={17} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-xs font-medium", !file && "text-muted-foreground")} title={file?.name}>
            {file?.name || emptyLabel}
          </div>
          <div className={cn("mt-1 text-[11px]", validationError ? "text-red-700" : "text-muted-foreground")}>
            {validationError || (file ? formatFileSize(file.size) : helperText)}
          </div>
        </div>
        {file && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={clearFile} disabled={disabled} aria-label="移除已选文件">
            <X size={14} />
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => inputRef.current?.click()} disabled={disabled}>
          <UploadCloud size={14} />{browseLabel}
        </Button>
      </div>
    </div>
  );
}
