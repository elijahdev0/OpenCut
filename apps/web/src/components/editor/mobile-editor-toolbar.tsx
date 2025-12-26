"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MediaPanel } from "@/components/editor/media-panel";
import { PropertiesPanel } from "@/components/editor/properties-panel";
import { Library, SlidersHorizontal } from "lucide-react";

export function MobileEditorToolbar() {
  const [mediaOpen, setMediaOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  return (
    <div className="px-3 py-2 border-b bg-background flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Sheet open={mediaOpen} onOpenChange={setMediaOpen}>
          <SheetTrigger asChild>
            <Button variant="secondary" size="sm" className="gap-2">
              <Library className="h-4 w-4" />
              Media
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[85vh] p-0">
            <MediaPanel />
          </SheetContent>
        </Sheet>

        <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
          <SheetTrigger asChild>
            <Button variant="secondary" size="sm" className="gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Inspector
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[85vh] p-0">
            <PropertiesPanel />
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

