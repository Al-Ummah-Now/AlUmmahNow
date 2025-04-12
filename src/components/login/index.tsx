import React from "react";
import {
  Button,
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "@material-tailwind/react";
import LoginWrapper from "./server";

const DialogDefault: React.FC<{ open: boolean, setOpen: (open: boolean) => void }> = ({ open, setOpen }) => {

  const handleOpen = () => setOpen(!open);

  return (
    <>
      <Dialog open={open} handler={handleOpen}>
        <DialogHeader>Login!</DialogHeader>
        <DialogBody>
          You will be redirected to the login page. Please enter your credentials
          to access your account. If you don&apos;t have an account, please register
        </DialogBody>
        <DialogFooter>
          <Button
            variant="text"
            color="red"
            onClick={handleOpen}
            className="mr-1"
          >
            <span>Cancel</span>
          </Button>
          <LoginWrapper />
        </DialogFooter>
      </Dialog>
    </>
  );
}

export default DialogDefault;