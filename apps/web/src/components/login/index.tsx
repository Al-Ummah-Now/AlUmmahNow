import React from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../ui/alert-dialog";
import { DialogDefaultProps } from "./interfaces";

const DialogDefault: React.FC<DialogDefaultProps> = ({ title, message, open, setOpen, children }) => {

  const handleOpen = () => setOpen(!open);

  return (
    <>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleOpen}>Cancel</AlertDialogCancel>
            {children}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default DialogDefault;