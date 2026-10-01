import { startPinService } from '@/shared/pin-service';
import { toggleSidebarOnActionClick } from '@/shared/sidebar-toggle';

export default defineBackground(() => {
  toggleSidebarOnActionClick(import.meta.env.FIREFOX);
  startPinService(import.meta.env.FIREFOX);
});
