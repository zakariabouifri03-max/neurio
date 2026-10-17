import { PRODUCTS, BASE_COLORS, formatPrice } from './rules.js';

const CART_KEY='monkey-store-cart-v1';
const ORDERS_KEY='monkey-store-orders-v1';

export class MonkeyStore {
  constructor() {
    this.cart = this.loadCart();
    this.orders = this.loadOrders();
    this.listeners=[];
  }
  loadCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)||'[]'); } catch { return []; }
  }
  loadOrders() {
    try { return JSON.parse(localStorage.getItem(ORDERS_KEY)||'[]'); } catch { return []; }
  }
  saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(this.cart)); } catch {}
    this.emit();
  }
  saveOrders() {
    try { localStorage.setItem(ORDERS_KEY, JSON.stringify(this.orders)); } catch {}
  }
  onChange(fn){ this.listeners.push(fn); }
  emit(){ this.listeners.forEach(fn=>fn(this.cart)); }

  getColor(hexId){ return BASE_COLORS.find(c=>c.id===hexId) || BASE_COLORS[0]; }
  getProduct(id){ return PRODUCTS.find(p=>p.id===id); }

  addToCart(productId, colorId, size, qty=1) {
    const product = this.getProduct(productId);
    if(!product) return;
    const color = this.getColor(colorId);
    const existing = this.cart.find(item=>item.productId===productId && item.colorId===colorId && item.size===size);
    if(existing){
      existing.qty += qty;
    } else {
      this.cart.push({ productId, colorId, size, qty, addedAt:Date.now() });
    }
    this.saveCart();
  }
  removeFromCart(index){
    this.cart.splice(index,1);
    this.saveCart();
  }
  updateQty(index, qty){
    if(qty<=0) this.removeFromCart(index);
    else { this.cart[index].qty=qty; this.saveCart(); }
  }
  clearCart(){ this.cart=[]; this.saveCart(); }

  cartTotal(){
    return this.cart.reduce((sum, item)=>{
      const p=this.getProduct(item.productId);
      return sum + (p?p.price:0)*item.qty;
    },0);
  }
  cartCount(){
    return this.cart.reduce((sum,item)=>sum+item.qty,0);
  }
  cartItemsDetailed(){
    return this.cart.map((item, idx)=>{
      const product=this.getProduct(item.productId);
      const color=this.getColor(item.colorId);
      return { ...item, product, color, index:idx, subtotal: product? product.price*item.qty : 0 };
    });
  }

  checkout(formData){
    const order={
      id: 'MNK-'+Date.now().toString(36).toUpperCase(),
      items: this.cartItemsDetailed(),
      total: this.cartTotal(),
      shipping: formData,
      createdAt: new Date().toISOString(),
      status:'paid',
    };
    this.orders.unshift(order);
    this.saveOrders();
    this.clearCart();
    return order;
  }
}
