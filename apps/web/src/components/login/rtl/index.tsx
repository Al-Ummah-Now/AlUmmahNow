import React from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../ui/alert-dialog";
import { DialogDefaultProps } from "../interfaces";

const DialogDefault: React.FC<DialogDefaultProps> = ({ title, message, open, setOpen, children }) => {
  const handleOpen = () => setOpen(!open);

  return (
    <>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent  style={{ direction: "rtl" }}>
          <AlertDialogHeader >
            <AlertDialogTitle className="text-right">
              {title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right">
              {message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleOpen}>إلغاء</AlertDialogCancel>
            {children}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default DialogDefault;