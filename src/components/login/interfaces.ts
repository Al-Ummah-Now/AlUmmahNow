export type DialogDefaultProps = { 
  title: string;
  message: string;
  open: boolean; 
  setOpen: (open: boolean) => void; 
  children: React.ReactNode; 
};