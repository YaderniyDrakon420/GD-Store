import Wallet from "./studio/Wallet";
import Support from "./studio/Support";
import { PointsHistory } from "./studio/ServiceFeatures";
import Teammates from "./studio/Teammates";
import CosmeticsShop from "./studio/CosmeticsShop";
import Gifts from "./studio/Gifts";
import Events from "./studio/Events";
import Notifications from "./studio/Notifications";
import Collections from "./studio/Collections";
import Admin from "./studio/Admin";
import Checkout from "./studio/Checkout";
import { Compare, Discover } from "./studio/Discovery";
import { Routes, Route } from "react-router-dom";
import { DemoProvider } from "./demo/context";
import { Shell, Store, NotFound } from "./studio/Studio";
import { Game, Collection, Profile } from "./studio/Personal";
import { Friends, Community, Workshop } from "./studio/Social";
import { Settings, Account, Orders } from "./studio/Account";
export default function App({ initialSnapshot }) {
  return (
    <DemoProvider initialSnapshot={initialSnapshot}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Store />} />
          <Route path="game/:slug" element={<Game />} />
          <Route
            path="library"
            element={<Collection key="library" kind="library" />}
          />
          <Route
            path="wishlist"
            element={<Collection key="wishlist" kind="wishlist" />}
          />
          <Route path="cart" element={<Collection key="cart" kind="cart" />} />
          <Route path="profile" element={<Profile />} />
          <Route path="profile/:id" element={<Profile />} />
          <Route path="friends" element={<Friends />} />
          <Route path="messages/:id" element={<Friends />} />
          <Route path="community" element={<Community />} />
          <Route path="community/:id" element={<Community />} />
          <Route path="workshop" element={<Workshop />} />
          <Route path="workshop/:id" element={<Workshop />} />
          <Route path="settings" element={<Settings />} />
          <Route path="login" element={<Account key="login" />} />
          <Route
            path="register"
            element={<Account key="register" register />}
          />
          <Route
            path="forgot-password"
            element={<Account key="reset" reset />}
          />
          <Route path="points-shop" element={<CosmeticsShop />} />
          <Route path="wallet" element={<Wallet />} />
          <Route path="support" element={<Support />} />
          <Route path="points-history" element={<PointsHistory />} />
          <Route path="teammates" element={<Teammates />} />
          <Route path="gifts" element={<Gifts />} />
          <Route path="orders" element={<Orders />} />
          <Route path="events" element={<Events />} />
          <Route path="events/:id" element={<Events />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="collections" element={<Collections />} />
          <Route path="collections/:id" element={<Collections />} />
          <Route path="admin" element={<Admin />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="compare" element={<Compare />} />
          <Route path="discover" element={<Discover />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </DemoProvider>
  );
}
