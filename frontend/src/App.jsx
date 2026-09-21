import ServerProfile from "./studio/ServerProfile";
import ServerFriends from "./studio/ServerFriends";
import {
  ServerOrders,
  ServerSettings,
  Unavailable,
} from "./studio/ServerAccount";
import Checkout from "./studio/Checkout";
import { Compare, Discover } from "./studio/Discovery";
import { Routes, Route } from "react-router-dom";
import { ApiProvider } from "./api/context";
import { Shell, Store, NotFound } from "./studio/Studio";
import { Game, Collection } from "./studio/Personal";
import Account from "./studio/AuthScreen";
export default function App() {
  return (
    <ApiProvider>
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
          <Route path="profile" element={<ServerProfile />} />
          <Route path="profile/:id" element={<ServerProfile />} />
          <Route path="friends" element={<ServerFriends />} />
          <Route path="messages/:id" element={<ServerFriends />} />
          <Route path="community" element={<Unavailable />} />
          <Route path="community/:id" element={<Unavailable />} />
          <Route path="workshop" element={<Unavailable />} />
          <Route path="workshop/:id" element={<Unavailable />} />
          <Route path="settings" element={<ServerSettings />} />
          <Route path="login" element={<Account key="login" />} />
          <Route
            path="register"
            element={<Account key="register" register />}
          />
          <Route
            path="forgot-password"
            element={<Unavailable />}
          />
          <Route path="points-shop" element={<Unavailable />} />
          <Route path="wallet" element={<Unavailable />} />
          <Route path="support" element={<Unavailable />} />
          <Route path="points-history" element={<Unavailable />} />
          <Route path="teammates" element={<Unavailable />} />
          <Route path="gifts" element={<Unavailable />} />
          <Route path="orders" element={<ServerOrders />} />
          <Route path="events" element={<Unavailable />} />
          <Route path="events/:id" element={<Unavailable />} />
          <Route path="notifications" element={<Unavailable />} />
          <Route path="collections" element={<Unavailable />} />
          <Route path="collections/:id" element={<Unavailable />} />
          <Route path="admin" element={<Unavailable />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="compare" element={<Compare />} />
          <Route path="discover" element={<Discover />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ApiProvider>
  );
}
