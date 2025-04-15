import React from "react";
import {
  Button,
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "@material-tailwind/react";
import LoginWrapper from "../server/rtl/";

const DialogDefault: React.FC<{ open: boolean; setOpen: (open: boolean) => void }> = ({ open, setOpen }) => {
  const handleOpen = () => setOpen(!open);

  return (
    <>
      <Dialog open={open} handler={handleOpen} className="rtl">
        <DialogHeader>تسجيل الدخول!</DialogHeader>
        <DialogBody>
          سيتم توجيهك إلى صفحة تسجيل الدخول. يرجى إدخال بيانات الاعتماد الخاصة بك للوصول إلى حسابك. إذا لم يكن لديك حساب، يرجى التسجيل.
        </DialogBody>
        <DialogFooter>
          <Button
            variant="text"
            color="red"
            onClick={handleOpen}
            className="mr-1"
          >
            <span>إلغاء</span>
          </Button>
          <LoginWrapper />
        </DialogFooter>
      </Dialog>
    </>
  );
};

export default DialogDefault;