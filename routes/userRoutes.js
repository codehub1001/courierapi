import express from "express";

import {
  registerUser,
  loginUser
} from "../controllers/userControllers.js";

const router = express.Router();


// Register vendor or rider
router.post("/register", registerUser);


// Login admin, vendor, or rider
router.post("/login", loginUser);


export default router;